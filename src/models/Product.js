const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    shortDescription: { type: String },
    fullDescription: { type: String },
    stockQuantity: { type: Number, required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    images: [{ type: String }], // Array of S3 keys
    discount: { type: Number, default: 0 },
    hasDiscount: { type: Boolean, default: false },
    sold: { type: Number, default: 0 },
    videoLink: { type: String }, // Video link field
    rating: { type: Number, default: 0 }, // Star rating field
  
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", productSchema);


