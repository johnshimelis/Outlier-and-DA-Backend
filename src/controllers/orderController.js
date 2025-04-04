const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3"); // AWS SDK v3
const multerS3 = require("multer-s3");
const path = require("path");
const multer = require("multer");
const Order = require("../models/Order");
const Product = require("../models/Product");

// Configure AWS S3 (SDK v3)
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Multer configuration for S3 (SDK v3)
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_BUCKET_NAME,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const fileName = `${Date.now()}${ext}`;
      cb(null, fileName);
    },
    acl: undefined, // Remove ACL configuration
  }),
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 
      'image/bmp', 'image/tiff', 'image/svg+xml', 'image/avif', 
      'application/octet-stream']; // Add 'application/octet-stream' for AVIF fallback
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.svg', '.webp', '.avif'];

    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file format: ${file.mimetype} (${ext})`), false);
    }
  },
});

// Helper function to get full image URL
const getImageUrl = (imageName) =>
  imageName ? `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${imageName}` : null;

// ✅ Create New Order
// ✅ Create New Order
exports.createOrder = async (req, res) => {
  try {
    console.log("📦 Starting order creation process");
    console.log("📝 Request body:", req.body);
    console.log("📸 Uploaded files:", req.files);

    const cleanedBody = {};
    Object.keys(req.body).forEach((key) => {
      cleanedBody[key.trim()] = req.body[key];
    });

    // Process payment image - CRUCIAL FIX
    let paymentImageUrl = null;
    if (req.files && req.files['paymentImage'] && req.files['paymentImage'][0]) {
      paymentImageUrl = req.files['paymentImage'][0].location;
      console.log("💰 Payment image URL:", paymentImageUrl);
    }

    // Process product images - CRUCIAL FIX
    let productImageUrls = [];
    if (req.files && req.files['productImages']) {
      productImageUrls = req.files['productImages'].map(file => file.location);
      console.log("🖼️ Product image URLs:", productImageUrls);
    }

    // Parse order details
    let orderDetails = [];
    if (cleanedBody.orderDetails) {
      try {
        orderDetails = JSON.parse(cleanedBody.orderDetails).map((item, index) => ({
          productId: item.productId,
          product: item.product,
          quantity: item.quantity || 1,
          price: item.price || 0,
          productImage: productImageUrls[index] || null
        }));
      } catch (error) {
        console.error("❌ Error parsing orderDetails:", error);
        return res.status(400).json({ error: "Invalid orderDetails format" });
      }
    }

    // Create new order
    const lastOrder = await Order.findOne().sort({ id: -1 });
    const newId = lastOrder ? lastOrder.id + 1 : 1;

    const newOrder = new Order({
      id: newId,
      userId: cleanedBody.userId || "Unknown ID",
      name: cleanedBody.name || "Unknown",
      amount: parseFloat(cleanedBody.amount) || 0,
      phoneNumber: cleanedBody.phoneNumber || "",
      deliveryAddress: cleanedBody.deliveryAddress || "",
      status: cleanedBody.status || "Pending",
      paymentImage: paymentImageUrl,
      avatar: req.files && req.files['avatar'] && req.files['avatar'][0] 
        ? req.files['avatar'][0].location 
        : "https://outlier-da.s3.eu-north-1.amazonaws.com/default-avatar.png",
      orderDetails,
      createdAt: new Date()
    });

    await newOrder.save();
    console.log("✅ Order created successfully:", newOrder);
    res.status(201).json(newOrder);
  } catch (error) {
    console.error("❌ Error creating order:", error);
    res.status(500).json({ 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// ✅ Update Order (Now Updates Product Stock & Sold when Delivered)
exports.updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    console.log("🔄 Updating Order:", updates);

    const order = await Order.findOneAndUpdate({ id: parseInt(id) }, updates, { new: true });

    if (!order) {
      return res.status(404).json({ error: "Order not found!" });
    }

    // ✅ If status is "Delivered", update product stock & sold values
    if (updates.status === "Delivered") {
      for (const item of order.orderDetails) {
        const product = await Product.findById(item.productId);

        if (product) {
          product.sold += item.quantity;
          product.stockQuantity -= item.quantity;
          await product.save();
        } else {
          console.error(`❌ Product not found for ID: ${item.productId}`);
        }
      }
    }

    res.status(200).json(order);
  } catch (error) {
    console.error("❌ Error updating order:", error.message);
    res.status(500).json({ error: "Failed to update order." });
  }
};

// ✅ Get all Orders
exports.getOrders = async (req, res) => {
  try {
    const orders = await Order.find().select(
      "id userId name avatar amount status phoneNumber deliveryAddress paymentImage orderDetails createdAt"
    );

    console.log("📤 Orders Fetched from Database:", JSON.stringify(orders, null, 2));

    res.json(orders);
  } catch (error) {
    console.error("❌ Error fetching orders:", error.message);
    res.status(500).json({ error: error.message });
  }
};

// ✅ Get Order By ID
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findOne({ id: req.params.id }).select(
      "id userId name avatar amount status phoneNumber deliveryAddress paymentImage orderDetails createdAt"
    );
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ✅ Delete Order
exports.deleteOrder = async (req, res) => {
  try {
    const deletedOrder = await Order.findOneAndDelete({ id: req.params.id });
    if (!deletedOrder) return res.status(404).json({ message: "Order not found" });
    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ✅ Delete All Orders
exports.deleteAllOrders = async (req, res) => {
  try {
    await Order.deleteMany({});
    res.json({ message: "All orders deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ✅ Get Order By Order ID and User ID
exports.getOrderByOrderIdAndUserId = async (req, res) => {
  const { orderId, userId } = req.params;
  console.log("Fetching order for:", orderId, userId); // Log the parameters

  try {
    const order = await Order.findOne({ id: orderId, userId: userId });

    if (!order) {
      console.log(`No order found for orderId: ${orderId} and userId: ${userId}`);
      return res.status(404).json({ message: "Order not found" });
    }

    res.json({ order });
  } catch (error) {
    console.error("Error retrieving order details:", error);
    res.status(500).json({ message: "Error retrieving order details" });
  }
};

// Export the upload middleware
module.exports.upload = upload;
