const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const { upload } = orderController;

// Create order with file uploads
router.post(
  "/",
  upload.fields([
    { name: "paymentImage", maxCount: 1 },
    { name: "productImages", maxCount: 10 }
  ]),
  orderController.createOrder
);

// Get all orders
router.get("/", orderController.getOrders);

// Get single order by ID
router.get("/:id", orderController.getOrderById);

// Get order by order ID and user ID
router.get("/:orderId/:userId", orderController.getOrderByOrderIdAndUserId);

// Update order (with optional payment image update)
router.put(
  "/:id",
  upload.fields([{ name: "paymentImage", maxCount: 1 }]),
  orderController.updateOrder
);

// Delete single order
router.delete("/:id", orderController.deleteOrder);

// Delete all orders
router.delete("/", orderController.deleteAllOrders);

module.exports = router;