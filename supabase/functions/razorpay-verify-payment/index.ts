import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") || "secret_placeholder"

// Natively calculate HMAC-SHA256 hex string via Web Crypto standard
async function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): Promise<boolean> {
    const encoder = new TextEncoder()
    const message = `${orderId}|${paymentId}`
    const keyData = encoder.encode(RAZORPAY_KEY_SECRET)
    const messageData = encoder.encode(message)

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
    // Enable CORS
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
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan_id } = await req.json()
        const authHeader = req.headers.get("Authorization")
        if (!authHeader) {
            return new Response(JSON.stringify({ error: "Missing authorization header" }), {
                status: 401,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            })
        }

        // Verify Razorpay signature to prevent tampering
        const isVerified = await verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)
        if (!isVerified) {
            return new Response(JSON.stringify({ error: "Invalid payment signature" }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            })
        }

        // Initialize Supabase Client with User Auth context to verify token validity
        const userClient = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_ANON_KEY") ?? "",
            { global: { headers: { Authorization: authHeader } } }
        )

        const { data: { user }, error: userError } = await userClient.auth.getUser()
        if (userError || !user) {
            return new Response(JSON.stringify({ error: "Invalid user token" }), {
                status: 401,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            })
        }

        // Initialize Supabase Admin Client for database modification with service role privileges
        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        )

        // Subscription timeline configurations
        const startsAt = new Date()
        const durationDays = plan_id === "yearly" ? 365 : 30
        const endsAt = new Date()
        endsAt.setDate(startsAt.getDate() + durationDays)
        const amount = plan_id === "yearly" ? 49900 : 4900; // in paise

        // 1. Log payment/subscription details in DB
        const { error: subError } = await supabaseAdmin.from("subscriptions").insert({
            user_id: user.id,
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            plan_id,
            status: "active",
            amount,
            starts_at: startsAt.toISOString(),
            ends_at: endsAt.toISOString()
        })
        if (subError) throw subError;

        // 2. Set premium flags on user profile
        const { error: userUpdateError } = await supabaseAdmin.from("users").update({
            is_premium: true,
            premium_until: endsAt.toISOString()
        }).eq("id", user.id)
        if (userUpdateError) throw userUpdateError;

        return new Response(JSON.stringify({ success: true, message: "Subscription activated successfully" }), {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        })
    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        })
    }
})
