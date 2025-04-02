const express = require("express");
const router = express.Router();
const {
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
  upload, // Import the upload middleware
} = require("../controllers/categoryController");

// Category Routes
router.post("/", upload.single("image"), createCategory); // Create category with image upload
router.get("/", getCategories); // Get all categories
router.get("/:id", getCategoryById); // Get a single category
router.put("/:id", upload.single("image"), updateCategory); // Update category with optional image
router.delete("/:id", deleteCategory); // Delete category

module.exports = router;
