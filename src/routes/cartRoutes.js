const express = require("express");
const {
  getCart,
  addToCart,
  removeFromCart,
  updateCartItem,
  clearCartByUserId,
  getCartItem, // Import the new function
} = require("../controllers/cartController");
const { uploadImage } = require("../middlewares/uploadMiddleware");
const authMiddleware = require("../middlewares/authMiddleware");

const router = express.Router();

router.get("/", authMiddleware, getCart);

// New route to get a specific cart item
router.get("/:productId", authMiddleware, getCartItem);

// Check if an image exists before applying `uploadImage`
router.post("/", authMiddleware, uploadImage, (req, res, next) => {
  console.log("🟢 Incoming Cart Request:", req.body);
  console.log("🟢 Uploaded File:", req.file);
  next();
}, addToCart);

router.delete("/:id", authMiddleware, removeFromCart);
router.put("/:id", authMiddleware, updateCartItem);
router.delete("/user/:userId", authMiddleware, clearCartByUserId);

module.exports = router;
