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

    if (allowedMimeTypes.includes(file.mimetype)) {  // Fixed this line - added missing parenthesis
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file format: ${file.mimetype}`), false);
    }
  },
}).fields([
  { name: 'paymentImage', maxCount: 1 },
  { name: 'productImages', maxCount: 10 }
]);

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
    // First handle the file uploads using multer
    upload(req, res, async (err) => {
      if (err) {
        console.error("❌ Multer upload error:", err);
        return res.status(400).json({ error: err.message });
      }

      try {
        const cleanedBody = {};
        Object.keys(req.body).forEach((key) => {
          cleanedBody[key.trim()] = req.body[key];
        });

        console.log("📌 Cleaned Request Body:", cleanedBody);
        console.log("📸 Uploaded Files:", req.files);

        const userId = cleanedBody.userId || "Unknown ID";
        const name = cleanedBody.name || "Unknown";
        const amount = cleanedBody.amount ? parseFloat(cleanedBody.amount) : 0;
        const phoneNumber = cleanedBody.phoneNumber || "";
        const deliveryAddress = cleanedBody.deliveryAddress || "";
        const status = cleanedBody.status || "Pending";

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

        // Handle product images upload
        let productImages = [];
        if (req.files && req.files['productImages']) {
          for (const productFile of req.files['productImages']) {
            const productFileName = `product-${uuidv4()}${path.extname(productFile.originalname)}`;
            const productImageUrl = await uploadToS3(
              productFile.buffer,
              productFileName,
              productFile.mimetype
            );
            productImages.push(productImageUrl);
          }
        }

        let orderDetails = [];
        if (cleanedBody.orderDetails) {
          try {
            orderDetails = JSON.parse(cleanedBody.orderDetails);

            orderDetails = await Promise.all(
              orderDetails.map(async (item, index) => {
                const product = await Product.findOne({ name: item.product });

                if (!product) {
                  console.error(`❌ Product not found: ${item.product}`);
                  return null;
                }

                console.log(`✅ Found Product: ${product.name} - ID: ${product._id}`);

                return {
                  productId: product._id,
                  product: item.product,
                  quantity: item.quantity || 1,
                  price: item.price || 0,
                  productImage: productImages[index] || null,
                };
              })
            );

            orderDetails = orderDetails.filter((item) => item !== null);
          } catch (error) {
            return res.status(400).json({ error: "Invalid JSON format in orderDetails" });
          }
        }

        console.log("✅ Final Order Details before saving:", orderDetails);

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
          orderDetails,
          createdAt: new Date(),
        });

        await newOrder.save();
        res.status(201).json(newOrder);
      } catch (error) {
        console.error("❌ Error creating order:", error.message);
        res.status(500).json({ error: error.message });
      }
    });
  } catch (error) {
    console.error("❌ Outer error in createOrder:", error.message);
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