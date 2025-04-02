const mongoose = require("mongoose");

const adSchema = new mongoose.Schema({
  images: [String],
  type: { type: String, required: true, enum: ["ads", "banner", "banner1"] }, // Differentiate types
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Ad", adSchema);
