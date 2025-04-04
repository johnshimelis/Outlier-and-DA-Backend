const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const multer = require("multer");
const path = require("path");
const Order = require("../models/Order");
const Product = require("../models/Product");

// Configure AWS S3
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Memory storage for multer
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  }
});

// Upload to S3 helper
const uploadToS3 = async (fileBuffer, fileName, mimetype) => {
  const uploadParams = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileName,
    Body: fileBuffer,
    ContentType: mimetype,
  };

  try {
    await s3.send(new PutObjectCommand(uploadParams));
    return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
  } catch (err) {
    console.error("S3 Upload Error:", err);
    throw err;
  }
};

// Create Order Controller
exports.createOrder = [
  upload.fields([
    { name: 'paymentImage', maxCount: 1 },
    { name: 'productImages', maxCount: 10 }
  ]),
  async (req, res) => {
    try {
      console.log("📦 Order creation started");
      console.log("📝 Text fields:", req.body);
      console.log("📸 Files received:", req.files);

      if (!req.files || (!req.files['paymentImage'] && !req.files['productImages'])) {
        return res.status(400).json({ error: "No files were uploaded" });
      }

      // Process text fields
      const { 
        userId, 
        name, 
        amount, 
        phoneNumber, 
        deliveryAddress, 
        status, 
        orderDetails 
      } = req.body;

      if (!userId || !name || !phoneNumber || !deliveryAddress || !orderDetails) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Process payment image
      let paymentImageUrl = null;
      if (req.files['paymentImage'] && req.files['paymentImage'][0]) {
        const paymentFile = req.files['paymentImage'][0];
        paymentImageUrl = await uploadToS3(
          paymentFile.buffer,
          `payment-${Date.now()}${path.extname(paymentFile.originalname)}`,
          paymentFile.mimetype
        );
        console.log("💰 Payment image uploaded:", paymentImageUrl);
      }

      // Process product images
      let productImageUrls = [];
      if (req.files['productImages']) {
        productImageUrls = await Promise.all(
          req.files['productImages'].map(async (file, index) => {
            const url = await uploadToS3(
              file.buffer,
              `product-${Date.now()}-${index}${path.extname(file.originalname)}`,
              file.mimetype
            );
            console.log(`🖼️ Product image ${index} uploaded:`, url);
            return url;
          })
        );
      }

      // Parse and validate order details
      let parsedOrderDetails = [];
      try {
        parsedOrderDetails = JSON.parse(orderDetails).map((item, index) => {
          if (!item.productId || !item.product) {
            throw new Error("Invalid product data in order details");
          }
          return {
            productId: item.productId,
            product: item.product,
            quantity: item.quantity || 1,
            price: item.price || 0,
            productImage: productImageUrls[index] || null
          };
        });
      } catch (error) {
        console.error("❌ Order details parsing error:", error);
        return res.status(400).json({ error: "Invalid orderDetails format" });
      }

      // Create new order
      const lastOrder = await Order.findOne().sort({ id: -1 });
      const newId = lastOrder ? lastOrder.id + 1 : 1;

      const newOrder = new Order({
        id: newId,
        userId,
        name,
        amount: parseFloat(amount) || 0,
        status: status || "Pending",
        phoneNumber,
        deliveryAddress,
        paymentImage: paymentImageUrl,
        orderDetails: parsedOrderDetails,
        createdAt: new Date(),
      });

      await newOrder.save();
      console.log("✅ Order created successfully:", newOrder);

      res.status(201).json(newOrder);
    } catch (error) {
      console.error("❌ Order creation failed:", error);
      res.status(500).json({ 
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
];

// Other controller methods remain the same...
exports.updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    console.log("🔄 Updating Order:", updates);

    const order = await Order.findOneAndUpdate({ id: parseInt(id) }, updates, { new: true });

    if (!order) {
      return res.status(404).json({ error: "Order not found!" });
    }

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

exports.getOrders = async (req, res) => {
  try {
    const orders = await Order.find().select(
      "id userId name avatar amount status phoneNumber deliveryAddress paymentImage orderDetails createdAt"
    );

    res.json(orders);
  } catch (error) {
    console.error("❌ Error fetching orders:", error.message);
    res.status(500).json({ error: error.message });
  }
};

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

exports.deleteOrder = async (req, res) => {
  try {
    const deletedOrder = await Order.findOneAndDelete({ id: req.params.id });
    if (!deletedOrder) return res.status(404).json({ message: "Order not found" });
    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteAllOrders = async (req, res) => {
  try {
    await Order.deleteMany({});
    res.json({ message: "All orders deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getOrderByOrderIdAndUserId = async (req, res) => {
  const { orderId, userId } = req.params;
  console.log("Fetching order for:", orderId, userId);

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

module.exports.upload = upload;
