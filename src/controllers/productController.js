const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const multerS3 = require("multer-s3");
const path = require("path");
const multer = require("multer");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Category = require("../models/Category");

// Configure AWS S3
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Multer upload configuration
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_BUCKET_NAME,
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      const ext = path.extname(file.originalname);
      const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      cb(null, fileName);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

    if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file format: ${file.mimetype} (${ext})`), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 10 // Max 10 files
  }
}).array('images', 10);

// Helper function to generate image URLs
const getImageUrl = (imageName) => {
  if (!imageName) return null;
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${imageName}`;
};

// Create product with image uploads
const createProduct = async (req, res) => {
  try {
    upload(req, res, async (err) => {
      if (err) {
        console.error("Upload error:", err);
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ 
            message: "File too large. Max size is 5MB",
            error: err.message 
          });
        }
        return res.status(400).json({ 
          message: "File upload failed",
          error: err.message 
        });
      }

      try {
        // Parse the product data from the form
        const {
          name,
          price,
          shortDescription,
          fullDescription,
          stockQuantity,
          category,
          discount = 0,
          hasDiscount = false,
          videoLink = "",
          rating = 0,
        } = req.body;

        // Validate required fields
        if (!name?.trim()) {
          return res.status(400).json({ message: "Product name is required" });
        }
        if (!price || isNaN(price)) {
          return res.status(400).json({ message: "Valid price is required" });
        }
        if (!category) {
          return res.status(400).json({ message: "Category is required" });
        }

        // Verify category exists
        const existingCategory = await Category.findById(category);
        if (!existingCategory) {
          return res.status(400).json({ message: "Invalid category ID" });
        }

        // Get uploaded files
        const images = req.files?.map(file => file.key) || [];

        // Create new product
        const newProduct = new Product({
          name: name.trim(),
          price: Number(price),
          shortDescription: shortDescription?.trim() || "",
          fullDescription: fullDescription?.trim() || "",
          stockQuantity: stockQuantity ? Number(stockQuantity) : 0,
          category,
          images,
          discount: hasDiscount ? Number(discount) : 0,
          hasDiscount: Boolean(hasDiscount),
          videoLink: videoLink?.trim() || "",
          rating: rating ? Number(rating) : 0,
        });

        await newProduct.save();
        const populatedProduct = await Product.findById(newProduct._id).populate("category", "name");

        // Prepare response with image URLs
        const responseProduct = {
          ...populatedProduct.toObject(),
          imageUrls: (populatedProduct.images || []).map(img => getImageUrl(img))
        };

        res.status(201).json(responseProduct);
      } catch (error) {
        console.error("Product creation error:", error);
        
        // Clean up uploaded files if product creation fails
        if (req.files && req.files.length > 0) {
          await Promise.all(req.files.map(file => 
            s3.send(new DeleteObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: file.key,
            })).catch(console.error)
          ));
        }
        
        res.status(500).json({ 
          message: "Failed to create product",
          error: error.message 
        });
      }
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ 
      message: "Server error",
      error: error.message 
    });
  }
};

// In your productController.js, modify the getAllProducts function:
const getAllProducts = async (req, res) => {
  try {
    const products = await Product.find().populate("category", "name");
    
    const productsWithUrls = products.map(product => ({
      ...product.toObject(),
      imageUrls: (product.images || []).map(img => 
        `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${img}`
      )
    }));

    res.json(productsWithUrls);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ 
      message: "Failed to fetch products",
      error: error.message 
    });
  }
};
// Get product by ID
const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate("category", "name");
    if (!product) return res.status(404).json({ message: "Product not found" });
    
    const responseProduct = {
      ...product.toObject(),
      imageUrls: (product.images || []).map(img => getImageUrl(img))
    };
    
    res.json(responseProduct);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update product
const updateProduct = async (req, res) => {
  try {
    upload(req, res, async (err) => {
      if (err) {
        console.error("Upload error:", err);
        return res.status(400).json({ 
          message: "File upload failed",
          error: err.message 
        });
      }

      try {
        const {
          name,
          price,
          shortDescription,
          fullDescription,
          stockQuantity,
          category,
          discount,
          hasDiscount,
          sold,
          videoLink,
          rating,
        } = req.body;

        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ message: "Product not found" });

        let updateData = {};

        if (name) updateData.name = name;
        if (price) updateData.price = price;
        if (shortDescription) updateData.shortDescription = shortDescription;
        if (fullDescription) updateData.fullDescription = fullDescription;
        if (discount !== undefined) updateData.discount = hasDiscount === "true" ? discount : 0;
        if (hasDiscount !== undefined) updateData.hasDiscount = hasDiscount === "true";
        if (videoLink) updateData.videoLink = videoLink;
        if (rating) updateData.rating = rating;

        // Handle sold count and stock adjustment
        if (sold !== undefined) {
          const newSold = Number(sold);
          if (newSold < product.sold) {
            return res.status(400).json({ message: "Sold count cannot decrease" });
          }

          const increaseInSold = newSold - product.sold;
          if (increaseInSold > 0) {
            const newStockQuantity = product.stockQuantity - increaseInSold;
            if (newStockQuantity < 0) {
              return res.status(400).json({ message: "Not enough stock available" });
            }
            updateData.stockQuantity = newStockQuantity;
          }

          updateData.sold = newSold;
        }

        if (stockQuantity !== undefined) {
          updateData.stockQuantity = Number(stockQuantity);
        }

        // Validate and update category
        if (category) {
          const existingCategory = await Category.findById(category);
          if (!existingCategory) return res.status(400).json({ message: "Invalid category ID" });
          updateData.category = category;
        }

        // Handle image upload
        if (req.files && req.files.length > 0) {
          // Delete old images
          if (product.images && product.images.length > 0) {
            await Promise.all(product.images.map(imageKey => 
              s3.send(new DeleteObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: imageKey,
              })).catch(console.error)
            ));
          }
          updateData.images = req.files.map(file => file.key);
        }

        // Update product
        const updatedProduct = await Product.findByIdAndUpdate(
          req.params.id, 
          updateData, 
          { new: true }
        ).populate("category", "name");

        if (!updatedProduct) return res.status(404).json({ message: "Product not found" });

        // Prepare response
        const responseProduct = {
          ...updatedProduct.toObject(),
          imageUrls: (updatedProduct.images || []).map(img => getImageUrl(img))
        };

        res.json({ 
          message: "Product updated successfully", 
          product: responseProduct 
        });
      } catch (error) {
        console.error("Update error:", error);
        res.status(500).json({ 
          message: "Failed to update product",
          error: error.message 
        });
      }
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ 
      message: "Server error",
      error: error.message 
    });
  }
};

// Delete product with proper Promise.all handling
const deleteProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    
    // Validate product ID format
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid product ID format" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Delete images from S3 if they exist
    if (product.images?.length > 0) {
      try {
        // Create array of delete promises
        const deletePromises = product.images.map(imageKey => {
          return s3.send(new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: imageKey,
          }));
        });

        // Wait for all deletions to complete
        await Promise.all(deletePromises);
      } catch (s3Error) {
        console.error("Error deleting images from S3:", s3Error);
        // Continue with product deletion even if image deletion fails
      }
    }

    // Delete the product from database
    await Product.findByIdAndDelete(productId);
    
    res.json({ 
      success: true,
      message: "Product deleted successfully",
      deletedProductId: productId
    });

  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to delete product",
      error: error.message,
      productId: req.params.id
    });
  }
};

// Get discounted products
const getDiscountedProducts = async (req, res) => {
  try {
    const discountedProducts = await Product.find({
      hasDiscount: true,
      discount: { $gt: 0 },
    }).populate("category", "name");

    const productsWithUrls = discountedProducts.map(product => ({
      ...product.toObject(),
      imageUrls: (product.images || []).map(img => getImageUrl(img)),
      originalPrice: product.price,
      calculatedPrice: product.price - (product.price * product.discount) / 100,
    }));

    res.json(productsWithUrls);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get best sellers
const getBestSellers = async (req, res) => {
  try {
    const bestSellers = await Product.find()
      .sort({ sold: -1 })
      .limit(5)
      .populate("category", "name");

    const productsWithUrls = bestSellers.map((product, index) => ({
      ...product.toObject(),
      rank: index + 1,
      imageUrls: (product.images || []).map(img => getImageUrl(img))
    }));

    res.json(productsWithUrls);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get non-discounted products
const getNonDiscountedProducts = async (req, res) => {
  try {
    const nonDiscountedProducts = await Product.find({
      hasDiscount: false,
      discount: 0,
    }).populate("category", "name");

    const productsWithUrls = nonDiscountedProducts.map(product => ({
      ...product.toObject(),
      imageUrls: (product.images || []).map(img => getImageUrl(img))
    }));

    res.json(productsWithUrls);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get products by category
const getProductsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    // 1. Validate the category ID
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ message: "Invalid category ID format" });
    }

    // 2. Check if category exists
    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // 3. Find products in this category
    const products = await Product.find({ category: categoryId })
      .populate("category", "name _id");

    if (products.length === 0) {
      return res.status(200).json({
        message: "No products found in this category",
        products: [],
        categoryName: category.name
      });
    }

    // 4. Add image URLs to each product
    const productsWithUrls = products.map(product => ({
      ...product.toObject(),
      imageUrls: product.images.map(img => 
        `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${img}`
      )
    }));

    res.json({
      categoryName: category.name,
      products: productsWithUrls
    });

  } catch (error) {
    console.error("Error fetching products by category:", error);
    res.status(500).json({ 
      message: "Server error",
      error: error.message 
    });
  }
};

module.exports = {
  createProduct,
  updateProduct,
  getAllProducts,
  getProductById,
  deleteProduct,
  getDiscountedProducts,
  getBestSellers,
  getNonDiscountedProducts,
  getProductsByCategory,
  upload
};