import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RAZORPAY_WEBHOOK_SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "webhook_secret_placeholder"

async function verifyWebhookSignature(bodyText: string, signature: string): Promise<boolean> {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(RAZORPAY_WEBHOOK_SECRET)
    const messageData = encoder.encode(bodyText)

    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    )

    const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        messageData
    )

    const hashArray = Array.from(new Uint8Array(signatureBuffer))
    const generatedSignature = hashArray.map(b => b.toString(16).padStart(2, "0")).join("")
    return generatedSignature === signature
}

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
                "Access-Control-Allow-Methods": "POST, OPTIONS"
            }
        })
    }

    try {
        const signature = req.headers.get("X-Razorpay-Signature")
        if (!signature) {
            return new Response(JSON.stringify({ error: "Missing signature header" }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            })
        }

        const bodyText = await req.text()
        const isVerified = await verifyWebhookSignature(bodyText, signature)
        if (!isVerified) {
            return new Response(JSON.stringify({ error: "Invalid webhook signature" }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            })
        }

        const eventData = JSON.parse(bodyText)
        const eventId = eventData.id
        const eventType = eventData.event

        // Initialize Supabase Admin Client
        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        )

        // 1. Check if event was already processed (Idempotency)
        const { data: existingEvent } = await supabaseAdmin
            .from("webhook_events")
            .select("id")
            .eq("id", eventId)
            .maybeSingle()

        if (existingEvent) {
            return new Response(JSON.stringify({ success: true, message: "Event already processed" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            })
        }

        // 2. Log event in DB to claim execution lock
        const { error: logError } = await supabaseAdmin.from("webhook_events").insert({
            id: eventId,
            event_type: eventType,
            payload: eventData
        })
        if (logError) throw logError;

        // 3. Process the specific event type
        if (eventType === "order.paid" || eventType === "payment.captured") {
            const paymentEntity = eventData.payload.payment?.entity || {};
            const orderEntity = eventData.payload.order?.entity || {};
            
            // Retrieve notes parameters
            const notes = paymentEntity.notes || orderEntity.notes || {};
            const userId = notes.user_id;
            const planId = notes.plan_id || "monthly";

            if (userId) {
                const startsAt = new Date()
                const durationDays = planId === "yearly" ? 365 : 30
                const endsAt = new Date()
                endsAt.setDate(startsAt.getDate() + durationDays)
                const amount = paymentEntity.amount || (planId === "yearly" ? 49900 : 4900);

                // Update subscriptions log table
                await supabaseAdmin.from("subscriptions").insert({
                    user_id: userId,
                    razorpay_order_id: paymentEntity.order_id || orderEntity.id,
                    razorpay_payment_id: paymentEntity.id,
                    razorpay_signature: signature,
                    plan_id: planId,
                    status: "active",
                    amount,
                    starts_at: startsAt.toISOString(),
                    ends_at: endsAt.toISOString()
                })

                // Set premium flag on public users profile
                await supabaseAdmin.from("users").update({
                    is_premium: true,
                    premium_until: endsAt.toISOString()
                }).eq("id", userId)
            }
        } 
        else if (eventType === "subscription.cancelled" || eventType === "subscription.halted") {
            const subscriptionEntity = eventData.payload.subscription?.entity || {};
            const notes = subscriptionEntity.notes || {};
            const userId = notes.user_id;

            if (userId) {
                // Downgrade subscription flags
                await supabaseAdmin.from("users").update({
                    is_premium: false,
                    premium_until: null
                }).eq("id", userId)

                // Update subscription status records to expired
                await supabaseAdmin.from("subscriptions")
                    .update({ status: "expired" })
                    .eq("user_id", userId)
                    .eq("status", "active")
            }
        } 
        else if (eventType === "refund.processed") {
            const refundEntity = eventData.payload.refund?.entity || {};
            const paymentId = refundEntity.payment_id;

            if (paymentId) {
                // Retrieve user ID associated with this payment ID
                const { data: sub } = await supabaseAdmin
                    .from("subscriptions")
                    .select("user_id")
                    .eq("razorpay_payment_id", paymentId)
                    .maybeSingle()

                if (sub?.user_id) {
                    await supabaseAdmin.from("users").update({
                        is_premium: false,
                        premium_until: null
                    }).eq("id", sub.user_id)

                    await supabaseAdmin.from("subscriptions")
                        .update({ status: "refunded" })
                        .eq("razorpay_payment_id", paymentId)
                }
            }
        }

        return new Response(JSON.stringify({ success: true, message: "Webhook processed successfully" }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        })
    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        })
    }
})
