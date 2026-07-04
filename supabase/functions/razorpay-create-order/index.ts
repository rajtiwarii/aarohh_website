import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") || "rzp_test_placeholder"
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") || "secret_placeholder"

serve(async (req) => {
    // Enable CORS for frontend accessibility
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
        const { plan_id } = await req.json()
        const authHeader = req.headers.get("Authorization")
        if (!authHeader) {
            return new Response(JSON.stringify({ error: "Missing authorization header" }), {
                status: 401,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            })
        }

        // Initialize Supabase Client using standard environment tokens
        const supabase = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_ANON_KEY") ?? "",
            { global: { headers: { Authorization: authHeader } } }
        )

        // Get user from active token
        const { data: { user }, error: userError } = await supabase.auth.getUser()
        if (userError || !user) {
            return new Response(JSON.stringify({ error: "Invalid user token" }), {
                status: 401,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            })
        }

        // Pricing logic: ₹49/month or ₹499/year
        const amount = plan_id === "yearly" ? 49900 : 4900; // in paise

        // Create Razorpay Order request
        const basicAuth = btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`)
        const razorpayReq = await fetch("https://api.razorpay.com/v1/orders", {
            method: "POST",
            headers: {
                "Authorization": `Basic ${basicAuth}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                amount,
                currency: "INR",
                receipt: `receipt_${user.id.substring(0, 8)}`,
                notes: {
                    user_id: user.id,
                    plan_id
                }
            })
        })

        const orderData = await razorpayReq.json()
        if (!razorpayReq.ok) {
            return new Response(JSON.stringify({ error: orderData.error?.description || "Razorpay order creation failed" }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            })
        }

        return new Response(JSON.stringify({ order_id: orderData.id, amount, currency: "INR" }), {
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
