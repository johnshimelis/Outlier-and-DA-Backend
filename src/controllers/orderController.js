const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const multer = require("multer");
const path = require("path");
const Order = require("../models/Order");
const Product = require("../models/Product");
const { v4: uuidv4 } = require('uuid');

// Configure AWS S3
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 
      'image/bmp', 'image/tiff', 'image/svg+xml', 'image/avif', 
      'application/octet-stream'];
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.svg', '.webp', '.avif'];

    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file format: ${file.mimetype} (${ext})`), false);
    }
  },
});

// Helper function to upload file to S3
const uploadToS3 = async (fileBuffer, fileName, mimetype) => {
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileName,
    Body: fileBuffer,
    ContentType: mimetype,
  };

  await s3.send(new PutObjectCommand(params));
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
};

// ✅ Create New Order
exports.createOrder = async (req, res) => {
  try {
    // First handle the file uploads
    const fileUpload = upload.fields([
      { name: 'paymentImage', maxCount: 1 },
      { name: 'productImages', maxCount: 10 }
    ]);

    fileUpload(req, res, async (err) => {
      if (err) {
        console.error("❌ Multer upload error:", err);
        return res.status(400).json({ error: err.message });
      }

      try {
        console.log("📌 Request Body:", req.body);
        console.log("📸 Uploaded Files:", req.files);

        const userId = req.body.userId || "Unknown ID";
        const name = req.body.name || "Unknown";
        const amount = req.body.amount ? parseFloat(req.body.amount) : 0;
        const phoneNumber = req.body.phoneNumber || "";
        const deliveryAddress = req.body.deliveryAddress || "";
        const status = req.body.status || "Pending";
        let orderDetails = [];

        try {
          orderDetails = JSON.parse(req.body.orderDetails);
        } catch (e) {
          console.error("❌ Error parsing orderDetails:", e);
          return res.status(400).json({ error: "Invalid orderDetails format" });
        }

        // Handle avatar (using default for now)
        const avatar = "https://outlier-da.s3.eu-north-1.amazonaws.com/default-avatar.png";

        // Handle payment image upload
        let paymentImage = null;
        if (req.files && req.files['paymentImage']) {
          const paymentFile = req.files['paymentImage'][0];
          const paymentFileName = `payment-${uuidv4()}${path.extname(paymentFile.originalname)}`;
          paymentImage = await uploadToS3(
            paymentFile.buffer,
            paymentFileName,
            paymentFile.mimetype
          );
        }

        // Process order details
        const processedOrderDetails = await Promise.all(
          orderDetails.map(async (item) => {
            try {
              const product = await Product.findById(item.productId?._id || item.productId);
              return {
                productId: product?._id || item.productId,
                product: product?.name || item.product,
                quantity: item.quantity || 1,
                price: item.price || product?.price || 0,
                productImage: product?.images?.[0] || null,
              };
            } catch (error) {
              console.error("Error processing product:", error);
              return null;
            }
          })
        );

        const validOrderDetails = processedOrderDetails.filter(item => item !== null);

        console.log("✅ Final Order Details:", validOrderDetails);

        const lastOrder = await Order.findOne().sort({ id: -1 });
        const newId = lastOrder ? lastOrder.id + 1 : 1;

        const newOrder = new Order({
          id: newId,
          userId,
          name,
          amount,
          status,
          phoneNumber,
          deliveryAddress,
          avatar,
          paymentImage,
          orderDetails: validOrderDetails,
          createdAt: new Date(),
        });

        await newOrder.save();
        res.status(201).json(newOrder);
      } catch (error) {
        console.error("❌ Error creating order:", error);
        res.status(500).json({ error: error.message });
      }
    });
  } catch (error) {
    console.error("❌ Outer error in createOrder:", error);
    res.status(500).json({ error: error.message });
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