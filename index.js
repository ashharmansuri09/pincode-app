require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const { checkPincode } = require("./delivery-rule.js");

const app = express();

// ---- Shopify signature check ----
function verifyShopifySignature(req, res, next) {
  const secret = process.env.SHOPIFY_API_SECRET;
  const { signature, ...rest } = req.query;

//   if (!secret || !signature) {
//     return res.status(401).json({ ok: false, error: "Invalid signature" });
//   }

  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`)
    .join("");

  const digest = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  const a = Buffer.from(digest);
  const b = Buffer.from(String(signature));

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: "Invalid signature" });
  }
  next();
}

// ---- Routes ----
app.get("/", (req, res) => res.send("Pincode checker running"));

app.get("/proxy/pincode", verifyShopifySignature, (req, res) => {
  const result = checkPincode(req.query.pincode);
  res.status(result.status).json(result.body);
});

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Running on http://localhost:${port}`));
}