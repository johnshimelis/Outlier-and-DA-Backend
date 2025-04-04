const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const multer = require("multer");
const path = require("path");
const Order = require("../models/Order");
const Product = require("../models/Product");

// Configure AWS S3 with error handling
let s3;
try {
  s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
} catch (s3Error) {
  console.error("❌ AWS S3 Configuration Error:", s3Error);
  throw new Error("Failed to initialize S3 client");
}

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

// Enhanced S3 upload helper with retries
const uploadToS3 = async (fileBuffer, fileName, mimetype) => {
  const uploadParams = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileName,
    Body: fileBuffer,
    ContentType: mimetype,
    ACL: 'public-read' // Ensure files are accessible
  };

  try {
    const data = await s3.send(new PutObjectCommand(uploadParams));
    console.log(`✅ S3 Upload Success for ${fileName}`);
    return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
  } catch (err) {
    console.error("❌ S3 Upload Error:", {
      fileName,
      error: err.message,
      stack: err.stack
    });
    throw new Error(`Failed to upload file to S3: ${err.message}`);
  }
};

// Create Order Controller with comprehensive validation
exports.createOrder = [
  upload.fields([
    { name: 'paymentImage', maxCount: 1 },
    { name: 'productImages', maxCount: 10 }
  ]),
  async (req, res) => {
    console.log("📦 Order creation request received");
    
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

      // Validate files
      if (!req.files || !req.files['paymentImage']) {
        return res.status(400).json({ 
          error: "Payment image is required" 
        });
      }

      // Destructure with defaults
      const { 
        userId, 
        name, 
        amount = 0, 
        phoneNumber, 
        deliveryAddress, 
        status = "Pending", 
        orderDetails 
      } = req.body;

      // Process payment image with validation
      let paymentImageUrl;
      try {
        const paymentFile = req.files['paymentImage'][0];
        paymentImageUrl = await uploadToS3(
          paymentFile.buffer,
          `payments/${Date.now()}-${paymentFile.originalname}`,
          paymentFile.mimetype
        );
        console.log("💰 Payment image processed:", paymentImageUrl);
      } catch (paymentError) {
        console.error("❌ Payment image processing failed:", paymentError);
        return res.status(500).json({ 
          error: "Failed to process payment image",
          details: paymentError.message
        });
      }

      // Process product images with error tolerance
      let productImageUrls = [];
      if (req.files['productImages']) {
        try {
          productImageUrls = await Promise.all(
            req.files['productImages'].map(async (file, index) => {
              try {
                const url = await uploadToS3(
                  file.buffer,
                  `products/${Date.now()}-${index}-${file.originalname}`,
                  file.mimetype
                );
                console.log(`🖼️ Product image ${index} processed:`, url);
                return url;
              } catch (fileError) {
                console.error(`⚠️ Failed to process product image ${index}:`, fileError);
                return null; // Continue with other images if one fails
              }
            })
          );
          // Filter out any failed uploads
          productImageUrls = productImageUrls.filter(url => url !== null);
        } catch (batchError) {
          console.error("⚠️ Partial failure processing product images:", batchError);
          // Continue with order even if some product images failed
        }
      }

      // Parse and validate order details
      let parsedOrderDetails;
      try {
        parsedOrderDetails = JSON.parse(orderDetails).map((item, index) => {
          if (!item.productId) {
            throw new Error(`Missing productId in item ${index}`);
          }
          
          return {
            productId: item.productId,
            product: item.product || `Product ${index + 1}`,
            quantity: item.quantity || 1,
            price: item.price || 0,
            productImage: productImageUrls[index] || null
          };
        });
      } catch (parseError) {
        console.error("❌ Order details parsing failed:", {
          error: parseError.message,
          orderDetails
        });
        return res.status(400).json({ 
          error: "Invalid orderDetails format",
          details: parseError.message
        });
      }

      // Generate order ID
      const lastOrder = await Order.findOne().sort({ id: -1 }).lean();
      const newId = lastOrder ? lastOrder.id + 1 : 1;

      // Create order document
      const newOrder = new Order({
        id: newId,
        userId,
        name,
        amount: parseFloat(amount),
        status,
        phoneNumber,
        deliveryAddress,
        paymentImage: paymentImageUrl,
        orderDetails: parsedOrderDetails,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Save with validation
      try {
        await newOrder.validate();
        const savedOrder = await newOrder.save();
        console.log("✅ Order created successfully:", savedOrder.id);

        return res.status(201).json({
          success: true,
          order: savedOrder
        });
      } catch (saveError) {
        console.error("❌ Order save failed:", {
          error: saveError.message,
          validationErrors: saveError.errors
        });
        return res.status(400).json({
          error: "Validation failed",
          details: saveError.message
        });
      }

    } catch (error) {
      console.error("❌ Critical order creation error:", {
        message: error.message,
        stack: error.stack,
        body: req.body,
        files: req.files ? Object.keys(req.files) : null
      });

      return res.status(500).json({
        error: "Internal server error",
        message: error.message,
        ...(process.env.NODE_ENV === 'development' && {
          stack: error.stack
        })
      });
    }
  }
];

// Enhanced Update Order Controller
exports.updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    console.log(`🔄 Updating Order ${id} with:`, updates);

    // Validate ID
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ error: "Invalid order ID" });
    }

    // Find and update
    const order = await Order.findOneAndUpdate(
      { id: parseInt(id) },
      { ...updates, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Handle delivery status
    if (updates.status === "Delivered") {
      try {
        await Promise.all(
          order.orderDetails.map(async (item) => {
            const product = await Product.findById(item.productId);
            if (product) {
              product.sold += item.quantity;
              product.stockQuantity -= item.quantity;
              await product.save();
            }
          })
        );
        console.log(`📦 Order ${id} marked as delivered and inventory updated`);
      } catch (inventoryError) {
        console.error(`⚠️ Inventory update failed for order ${id}:`, inventoryError);
        // Continue even if inventory update fails
      }
    }

    return res.json({
      success: true,
      order
    });

  } catch (error) {
    console.error(`❌ Order update failed for ID ${req.params.id}:`, error);
    return res.status(500).json({
      error: "Failed to update order",
      message: error.message
    });
  }
};

// Get Orders with pagination and filtering
exports.getOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const filter = status ? { status } : {};

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .select("-__v");

    const total = await Order.countDocuments(filter);

    return res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error("❌ Error fetching orders:", error);
    return res.status(500).json({
      error: "Failed to fetch orders",
      message: error.message
    });
  }
};

// Get Order By ID with enhanced error handling
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findOne({ id: req.params.id })
      .select("-__v")
      .lean();

    if (!order) {
      return res.status(404).json({ 
        error: "Order not found",
        id: req.params.id
      });
    }

    // Populate product details if needed
    if (req.query.populate === "products") {
      const productIds = order.orderDetails.map(item => item.productId);
      const products = await Product.find({ _id: { $in: productIds } })
        .select("name price images")
        .lean();

      order.orderDetails = order.orderDetails.map(item => ({
        ...item,
        productDetails: products.find(p => p._id.toString() === item.productId.toString())
      }));
    }

    return res.json({
      success: true,
      order
    });

  } catch (error) {
    console.error(`❌ Error fetching order ${req.params.id}:`, error);
    return res.status(500).json({
      error: "Failed to fetch order",
      message: error.message
    });
  }
};

// Delete Order with confirmation
exports.deleteOrder = async (req, res) => {
  try {
    const deletedOrder = await Order.findOneAndDelete({ id: req.params.id });

    if (!deletedOrder) {
      return res.status(404).json({ 
        error: "Order not found",
        id: req.params.id
      });
    }

    console.log(`🗑️ Order ${req.params.id} deleted`);
    return res.json({
      success: true,
      message: "Order deleted successfully"
    });

  } catch (error) {
    console.error(`❌ Error deleting order ${req.params.id}:`, error);
    return res.status(500).json({
      error: "Failed to delete order",
      message: error.message
    });
  }
};

// Get Order By User and Order ID
exports.getOrderByOrderIdAndUserId = async (req, res) => {
  try {
    const { orderId, userId } = req.params;

    const order = await Order.findOne({ 
      id: orderId, 
      userId 
    }).select("-__v");

    if (!order) {
      return res.status(404).json({ 
        error: "Order not found",
        orderId,
        userId
      });
    }

    return res.json({
      success: true,
      order
    });

  } catch (error) {
    console.error("❌ Error fetching user order:", error);
    return res.status(500).json({
      error: "Failed to fetch order",
      message: error.message
    });
  }
};

module.exports.upload = upload;
