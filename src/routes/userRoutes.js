const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const UserOrder = require("../models/UserOrder");
const Message = require("../models/Message");
const Notification = require("../models/Notification");

// ===================== CRUD Operations for Orders =====================

// Create Order
router.post("/orders", authMiddleware, async (req, res) => {
  const { userId, date, status, total, orderId } = req.body;

  if (!userId || !date || !status || total === undefined || !orderId) {
    return res.status(400).json({ message: "All fields are required, including orderId" });
  }

  try {
    // Check if orderId already exists
    const existingOrder = await UserOrder.findOne({ orderId });
    if (existingOrder) {
      return res.status(400).json({ message: "Order with this ID already exists" });
    }

    const newOrder = new UserOrder({
      userId,
      date,
      status,
      total,
      orderId,
    });

    await newOrder.save();
    res.status(201).json({ message: "Order created successfully", newOrder });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ message: "Error creating order", error: error.message });
  }
});


// Fetch All Orders
router.get("/orders", authMiddleware, async (req, res) => {
  try {
    const orders = await UserOrder.find();
    res.json({ orders });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Error fetching orders" });
  }
});

// Fetch Orders by User ID
router.get("/orders/:userId", authMiddleware, async (req, res) => {
  try {
    const orders = await UserOrder.find({ userId: req.params.userId });
    res.json({ orders });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Error fetching orders" });
  }
});

// Update Order
router.put("/orders/:orderId", authMiddleware, async (req, res) => {
  try {
    const updatedOrder = await UserOrder.findByIdAndUpdate(
      req.params.orderId,
      req.body,
      { new: true }
    );
    if (!updatedOrder) return res.status(404).json({ message: "Order not found" });
    res.json({ message: "Order updated successfully", updatedOrder });
  } catch (error) {
    res.status(500).json({ message: "Error updating order" });
  }
});

// Get Order by orderId and userId
router.get("/orders/:orderId/:userId", authMiddleware, async (req, res) => {
  try {
    // Find the order using both orderId and userId
    const order = await UserOrder.findOne({ orderId: req.params.orderId, userId: req.params.userId });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Send the order details back
    res.json({ order });
  } catch (error) {
    res.status(500).json({ message: "Error retrieving order" });
  }
});


// Delete Order by orderId
router.delete("/orders/:orderId", authMiddleware, async (req, res) => {
  try {
    // Find and delete the order by orderId
    const deletedOrder = await UserOrder.findOneAndDelete({ orderId: req.params.orderId });

    if (!deletedOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting order" });
  }
});


// ===================== CRUD Operations for Messages =====================

// Create Message
router.post("/messages", authMiddleware, async (req, res) => {
  const { userId, from, message } = req.body;

  if (!userId || !from || !message) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const newMessage = new Message({ userId, from, message, read: false });
    await newMessage.save();
    res.status(201).json({ message: "Message sent successfully", newMessage });
  } catch (error) {
    res.status(500).json({ message: "Error sending message" });
  }
});

// Fetch All Messages
router.get("/messages", authMiddleware, async (req, res) => {
  try {
    const messages = await Message.find();
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ message: "Error fetching messages" });
  }
});

// Fetch Messages by User ID
router.get("/messages/:userId", authMiddleware, async (req, res) => {
  try {
    const messages = await Message.find({ userId: req.params.userId });
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ message: "Error fetching messages" });
  }
});

// Update Message
router.put("/messages/:messageId", authMiddleware, async (req, res) => {
  try {
    const updatedMessage = await Message.findByIdAndUpdate(
      req.params.messageId,
      req.body,
      { new: true }
    );
    if (!updatedMessage) return res.status(404).json({ message: "Message not found" });
    res.json({ message: "Message updated successfully", updatedMessage });
  } catch (error) {
    res.status(500).json({ message: "Error updating message" });
  }
});

// Delete Message
router.delete("/messages/:messageId", authMiddleware, async (req, res) => {
  try {
    const deletedMessage = await Message.findByIdAndDelete(req.params.messageId);
    if (!deletedMessage) return res.status(404).json({ message: "Message not found" });
    res.json({ message: "Message deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting message" });
  }
});

// ===================== CRUD Operations for Notifications =====================

// Create Notification
router.post("/notifications", authMiddleware, async (req, res) => {
  const { userId, orderId, message } = req.body;

  if (!userId || !message) {
    return res.status(400).json({ message: "User ID and message are required" });
  }

  try {
    const newNotification = new Notification({
      userId,
      orderId: orderId ? String(orderId) : null,
      message,
    });

    await newNotification.save();
    res.status(201).json({ message: "Notification created successfully", newNotification });
  } catch (error) {
    console.error("Error creating notification:", error);
    res.status(500).json({ message: "Error creating notification", error: error.message });
  }
});
// Fetch Notifications for Logged-in User
router.get("/notifications", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id; // Extract user ID from auth middleware

    const notifications = await Notification.find({ userId }).sort({ date: -1 });

    res.json({ notifications });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "Error fetching notifications" });
  }
});

// Fetch Notifications by User ID
router.get("/notifications/:userId", authMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.params.userId }).sort({ date: -1 });

    res.json({ notifications });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "Error fetching notifications" });
  }
});

// Update Notification
router.put("/notifications/:notificationId", authMiddleware, async (req, res) => {
  try {
    const updatedNotification = await Notification.findByIdAndUpdate(
      req.params.notificationId,
      req.body,
      { new: true }
    );

    if (!updatedNotification) return res.status(404).json({ message: "Notification not found" });

    res.json({ message: "Notification updated successfully", updatedNotification });
  } catch (error) {
    console.error("Error updating notification:", error);
    res.status(500).json({ message: "Error updating notification" });
  }
});

// Delete Notification (Only if it belongs to the user)
router.delete("/notifications/:notificationId", authMiddleware, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.notificationId);
    if (!notification) return res.status(404).json({ message: "Notification not found" });

    if (notification.userId.toString() !== req.user.id) {
      return res.status(403).json({ message: "Not authorized to delete this notification" });
    }

    await notification.deleteOne();
    res.json({ message: "Notification deleted successfully" });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ message: "Error deleting notification" });
  }
});

module.exports = router;