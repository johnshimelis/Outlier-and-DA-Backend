const mongoose = require("mongoose");

const userOrderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true }, // Add orderId field
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // Link to User
  date: { type: Date, required: true },  // Order date
  status: { type: String, required: true },  // Order status
  total: { type: Number, required: true },  // Total amount for the order
});

// Create and export the model based on the schema
module.exports = mongoose.model("UserOrder", userOrderSchema);
