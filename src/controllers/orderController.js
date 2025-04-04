const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const multer = require("multer");
const path = require("path");
const Order = require("../models/Order");
const Product = require("../models/Product");

// Configure AWS S3 with enhanced error handling
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Configure multer with strict validation
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Only JPEG, PNG, and WEBP are allowed.`), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 11 // 1 payment + max 10 product images
  }
});

// Enhanced S3 upload helper with better error handling
const uploadToS3 = async (fileBuffer, fileName, mimetype) => {
  const uploadParams = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileName,
    Body: fileBuffer,
    ContentType: mimetype,
    ACL: 'public-read'
  };

  try {
    await s3.send(new PutObjectCommand(uploadParams));
    return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
  } catch (err) {
    console.error("S3 Upload Error:", err);
    throw new Error(`Failed to upload file to S3: ${err.message}`);
  }
};

// Create Order with comprehensive validation
exports.createOrder = [
  upload.fields([
    { name: 'paymentImage', maxCount: 1 },
    { name: 'productImages', maxCount: 10 }
  ]),
  async (req, res) => {
    try {
      // Validate required fields
      const requiredFields = ['userId', 'name', 'phoneNumber', 'deliveryAddress', 'orderDetails'];
      const missingFields = requiredFields.filter(field => !req.body[field]);
      
      if (missingFields.length > 0) {
        return res.status(400).json({
          error: "Missing required fields",
          missingFields
        });
      }

      // Process files
      if (!req.files?.['paymentImage']) {
        return res.status(400).json({ error: "Payment image is required" });
      }

      // Process payment image
      const paymentFile = req.files['paymentImage'][0];
      const paymentImageUrl = await uploadToS3(
        paymentFile.buffer,
        `payments/${Date.now()}${path.extname(paymentFile.originalname)}`,
        paymentFile.mimetype
      );

      // Process product images
      let productImageUrls = [];
      if (req.files['productImages']) {
        productImageUrls = await Promise.all(
          req.files['productImages'].map(async (file, index) => {
            const url = await uploadToS3(
              file.buffer,
              `products/${Date.now()}-${index}${path.extname(file.originalname)}`,
              file.mimetype
            );
            return url;
          })
        );
      }

      // Parse order details
      const orderDetails = JSON.parse(req.body.orderDetails).map((item, index) => ({
        productId: item.productId,
        product: item.product || `Product ${index + 1}`,
        quantity: item.quantity || 1,
        price: item.price || 0,
        productImage: productImageUrls[index] || null
      }));

      // Create new order
      const lastOrder = await Order.findOne().sort({ id: -1 });
      const newOrder = new Order({
        id: lastOrder ? lastOrder.id + 1 : 1,
        userId: req.body.userId,
        name: req.body.name,
        amount: parseFloat(req.body.amount) || 0,
        phoneNumber: req.body.phoneNumber,
        deliveryAddress: req.body.deliveryAddress,
        status: req.body.status || "Pending",
        paymentImage: paymentImageUrl,
        orderDetails,
        createdAt: new Date()
      });

      await newOrder.save();
      res.status(201).json(newOrder);
    } catch (error) {
      console.error("Order creation failed:", error);
      res.status(500).json({ 
        error: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }
  }
];

// Get all orders with pagination
exports.getOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const query = status ? { status } : {};

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    res.json({
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get single order by ID
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findOne({ id: req.params.id });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update order
exports.updateOrder = async (req, res) => {
  try {
    const order = await Order.findOneAndUpdate(
      { id: req.params.id },
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Update product inventory if status changed to Delivered
    if (req.body.status === "Delivered") {
      await Promise.all(
        order.orderDetails.map(async item => {
          const product = await Product.findById(item.productId);
          if (product) {
            product.stockQuantity -= item.quantity;
            product.sold += item.quantity;
            await product.save();
          }
        })
      );
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete single order
exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findOneAndDelete({ id: req.params.id });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete all orders
exports.deleteAllOrders = async (req, res) => {
  try {
    await Order.deleteMany({});
    res.json({ message: "All orders deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get order by order ID and user ID
exports.getOrderByOrderIdAndUserId = async (req, res) => {
  try {
    const order = await Order.findOne({ 
      id: req.params.orderId, 
      userId: req.params.userId 
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Export upload middleware
exports.upload = upload;
