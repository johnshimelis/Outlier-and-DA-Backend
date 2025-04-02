const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");

// Product routes
router.post("/", productController.createProduct);
router.get("/", productController.getAllProducts);
router.get("/discounted", productController.getDiscountedProducts);
router.get("/bestsellers", productController.getBestSellers);
router.get("/nondiscount", productController.getNonDiscountedProducts);
router.get("/:id", productController.getProductById);
// In your productRoutes.js
router.get("/category/:categoryId", productController.getProductsByCategory);
router.put("/:id", productController.updateProduct);
router.delete("/:id", productController.deleteProduct);

module.exports = router;