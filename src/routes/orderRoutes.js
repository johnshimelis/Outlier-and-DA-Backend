const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const multer = require("multer");

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage });

// Use correct file handling
router.post(
  "/",
  upload.fields([
    { name: "avatar", maxCount: 1 },  // ✅ Fix: Add avatar field
    { name: "paymentImage", maxCount: 1 },
    { name: "productImages", maxCount: 10 },
  ]),
  orderController.createOrder
);
router.get("/:orderId/:userId", orderController.getOrderByOrderIdAndUserId);


router.get("/", orderController.getOrders);
router.get("/:id", orderController.getOrderById);
router.put("/:id", upload.fields([{ name: "paymentImage", maxCount: 1 }]), orderController.updateOrder);
router.delete("/:id", orderController.deleteOrder);
router.delete("/", orderController.deleteAllOrders);

module.exports = router;
