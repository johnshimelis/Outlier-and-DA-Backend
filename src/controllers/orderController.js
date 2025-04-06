const { S3Client } = require("@aws-sdk/client-s3");
const multerS3 = require("multer-s3");
const path = require("path");
const multer = require("multer");
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

// Enhanced S3 URL generator
const getImageUrl = (key) => {
  if (!key) return null;
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};

// Robust multer configuration
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_BUCKET_NAME,
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      const folder = file.fieldname === 'paymentImage' ? 'payments/' : 'products/';
      const fileName = `${folder}${Date.now()}${path.extname(file.originalname)}`;
      cb(null, fileName);
    },
  }),
  fileFilter: function (req, file, cb) {
    const validMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (validMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}`), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 11 // 1 payment + 10 product images
  }
}).fields([
  { name: 'paymentImage', maxCount: 1 },
  { name: 'productImages', maxCount: 10 }
]);

// Fixed createOrder function
exports.createOrder = async (req, res) => {
  try {
    console.log('=== STARTING ORDER PROCESSING ===');
    console.log('Received files:', Object.keys(req.files || {}));

    // 1. Process payment image - THE CRITICAL FIX
    let paymentImageUrl = null;
    if (req.files?.paymentImage?.[0]) {
      paymentImageUrl = getImageUrl(req.files.paymentImage[0].key);
      console.log('Payment image URL:', paymentImageUrl);
    } else {
      console.warn('No payment image found in request');
      // Check for alternative field names as fallback
      for (const field of ['payment', 'screenshot', 'file']) {
        if (req.files?.[field]?.[0]) {
          paymentImageUrl = getImageUrl(req.files[field][0].key);
          console.warn(`Fallback: Found payment image in ${field} field`);
          break;
        }
      }
    }

    // 2. Process product images
    const productImages = req.files?.productImages?.map(file => getImageUrl(file.key)) || [];
    console.log(`Processed ${productImages.length} product images`);

    // 3. Parse and validate order details
    let orderDetails = [];
    try {
      if (req.body.orderDetails) {
        orderDetails = JSON.parse(req.body.orderDetails).map((item, index) => ({
          ...item,
          productImage: productImages[index] || item.productImage || null
        }));
      }
    } catch (e) {
      console.error('Error parsing orderDetails:', e);
      return res.status(400).json({ error: 'Invalid orderDetails format' });
    }

    // 4. Create the order with all data
    const lastOrder = await Order.findOne().sort({ id: -1 });
    const newOrder = new Order({
      id: (lastOrder?.id || 0) + 1,
      userId: req.body.userId,
      name: req.body.name,
      amount: parseFloat(req.body.amount) || 0,
      status: req.body.status || 'Pending',
      phoneNumber: req.body.phoneNumber,
      deliveryAddress: req.body.deliveryAddress,
      paymentImage: paymentImageUrl, // This will now be properly set
      orderDetails,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // 5. Save and return the order
    await newOrder.save();
    console.log('Order successfully created with paymentImage:', newOrder.paymentImage !== null);

    res.status(201).json(newOrder);

  } catch (error) {
    console.error('ORDER CREATION ERROR:', {
      message: error.message,
      stack: error.stack,
      body: req.body,
      files: req.files ? Object.keys(req.files) : null
    });
    res.status(500).json({ 
      error: 'Failed to create order',
      details: process.env.NODE_ENV === 'development' ? error.message : null
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