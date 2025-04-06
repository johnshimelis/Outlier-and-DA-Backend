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

// Helper function to get full image URL
const getImageUrl = (imageName) =>
  imageName ? `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${imageName}` : null;

// Multer configuration for S3
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_BUCKET_NAME,
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      const ext = path.extname(file.originalname);
      const fileName = `${Date.now()}${ext}`;
      cb(null, fileName);
    },
  }),
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed!'));
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  }
});

// Create New Order
exports.createOrder = async (req, res) => {
  try {
    console.log("=== STARTING ORDER CREATION ===");
    console.log("Request files received:", Object.keys(req.files || {}));

    // 1. Process request body
    const cleanedBody = {};
    Object.keys(req.body).forEach((key) => {
      cleanedBody[key.trim()] = req.body[key];
    });
    console.log("Cleaned request body:", cleanedBody);

    // 2. Process payment image (critical fix)
    let paymentImage = null;
    if (req.files && req.files['paymentImage'] && req.files['paymentImage'][0]) {
      paymentImage = getImageUrl(req.files['paymentImage'][0].key);
      console.log("Payment image found and processed:", paymentImage);
    } else {
      console.warn("No payment image found in request");
    }

    // 3. Process product images
    const productImages = [];
    if (req.files && req.files['productImages']) {
      req.files['productImages'].forEach(file => {
        productImages.push(getImageUrl(file.key));
      });
      console.log(`Processed ${productImages.length} product images`);
    }

    // 4. Process order details
    let orderDetails = [];
    if (cleanedBody.orderDetails) {
      try {
        const parsedDetails = JSON.parse(cleanedBody.orderDetails);
        console.log("Raw order details:", parsedDetails);

        orderDetails = await Promise.all(parsedDetails.map(async (item, index) => {
          const product = await Product.findById(item.productId) || 
                         await Product.findOne({ name: item.product });

          if (!product) {
            console.warn(`Product not found for item: ${JSON.stringify(item)}`);
            return null;
          }

          return {
            productId: product._id,
            product: product.name,
            quantity: item.quantity || 1,
            price: item.price || product.price || 0,
            productImage: productImages[index] || item.productImage || product.image || null,
          };
        }));

        orderDetails = orderDetails.filter(item => item !== null);
        console.log("Processed order details:", orderDetails);
      } catch (error) {
        console.error("Error processing order details:", error);
        return res.status(400).json({ error: "Invalid order details format" });
      }
    }

    // 5. Create order
    const lastOrder = await Order.findOne().sort({ id: -1 });
    const newId = lastOrder ? lastOrder.id + 1 : 1;

    const newOrder = new Order({
      id: newId,
      userId: cleanedBody.userId,
      name: cleanedBody.name,
      amount: parseFloat(cleanedBody.amount) || 0,
      status: cleanedBody.status || "Pending",
      phoneNumber: cleanedBody.phoneNumber,
      deliveryAddress: cleanedBody.deliveryAddress,
      paymentImage, // This will now be properly set
      orderDetails,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await newOrder.save();
    console.log("Order successfully created:", newOrder);

    res.status(201).json(newOrder);
  } catch (error) {
    console.error("Order creation failed:", error);
    res.status(500).json({ 
      error: "Failed to create order",
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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