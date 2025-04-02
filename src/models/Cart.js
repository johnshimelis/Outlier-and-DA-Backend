const mongoose = require("mongoose");

const cartSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
  items: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Product" },
      productName: { type: String, required: true },
      img: { type: String }, // Store image URL
      price: { type: Number, required: true },
      quantity: { type: Number, required: true, default: 1 }
    }
  ]
});

const Cart = mongoose.model("Cart", cartSchema);
module.exports = Cart;
