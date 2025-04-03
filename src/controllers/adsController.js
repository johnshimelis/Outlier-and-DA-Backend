const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const multerS3 = require("multer-s3");
const path = require("path");
const multer = require("multer");
const Ad = require("../models/Ad");

// Configure AWS S3 with enhanced settings
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  maxAttempts: 3, // Retry failed requests
});

// Robust Multer-S3 configuration
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_BUCKET_NAME,
    acl: 'public-read',
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: function (req, file, cb) {
      cb(null, { 
        fieldName: file.fieldname,
        originalName: file.originalname 
      });
    },
    key: function (req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase();
      const fileName = `ads/${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
      cb(null, fileName);
    }
  }),
  fileFilter: function (req, file, cb) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WEBP are allowed!'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 5
  }
});

// Enhanced URL generator with CDN support
const getImageUrl = (imageKey) => {
  if (!imageKey) return null;
  if (process.env.AWS_CDN_URL) {
    return `${process.env.AWS_CDN_URL}/${imageKey}`;
  }
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${imageKey}`;
};

// Upload Ads with improved error handling
exports.uploadAd = async (req, res) => {
  try {
    const { type } = req.params;
    const validTypes = ["ads", "banner", "banner1"];
    
    if (!validTypes.includes(type)) {
      return res.status(400).json({ 
        success: false,
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No files were uploaded"
      });
    }

    const imageKeys = req.files.map(file => file.key);
    const ad = new Ad({ 
      images: imageKeys, 
      type,
      createdAt: new Date()
    });

    await ad.save();

    const responseData = {
      ...ad.toObject(),
      images: ad.images.map(imageKey => getImageUrl(imageKey))
    };

    res.status(201).json({
      success: true,
      message: `${type} uploaded successfully`,
      data: responseData
    });

  } catch (error) {
    console.error("Upload error:", error);
    
    // Cleanup uploaded files if error occurred
    if (req.files?.length > 0) {
      await Promise.all(req.files.map(file => {
        return s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: file.key
        })).catch(cleanupError => {
          console.error("Cleanup error:", cleanupError);
        });
      }));
    }

    res.status(500).json({
      success: false,
      error: error.message || "Failed to upload files"
    });
  }
};

// Get Ads with caching headers
exports.getAds = async (req, res) => {
  try {
    const { type } = req.params;
    const ads = await Ad.find({ type }).sort({ createdAt: -1 });

    const responseData = ads.map(ad => ({
      ...ad.toObject(),
      images: ad.images.map(imageKey => getImageUrl(imageKey))
    }));

    // Add caching headers
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error("Fetch error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch ads"
    });
  }
};

// Delete Ad with existence check
exports.deleteAd = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({
        success: false,
        error: "Ad not found"
      });
    }

    // Parallel delete for better performance
    await Promise.all([
      ...ad.images.map(imageKey => 
        s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: imageKey
        })).catch(err => console.error("Delete image error:", err))
      ),
      ad.deleteOne()
    ]);

    res.json({
      success: true,
      message: "Ad deleted successfully"
    });

  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete ad"
    });
  }
};

// Update Ad with transaction-like behavior
exports.updateAd = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({
        success: false,
        error: "Ad not found"
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No new files provided for update"
      });
    }

    // Store old images for cleanup
    const oldImages = [...ad.images];
    const newImages = req.files.map(file => file.key);

    // Update document
    ad.images = newImages;
    ad.updatedAt = new Date();
    await ad.save();

    // Cleanup old images after successful update
    await Promise.all(oldImages.map(imageKey => 
      s3.send(new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: imageKey
      })).catch(err => console.error("Cleanup error:", err))
    );

    res.json({
      success: true,
      message: "Ad updated successfully",
      data: {
        ...ad.toObject(),
        images: ad.images.map(imageKey => getImageUrl(imageKey))
      }
    });

  } catch (error) {
    console.error("Update error:", error);
    
    // Cleanup newly uploaded files if error occurred
    if (req.files?.length > 0) {
      await Promise.all(req.files.map(file => 
        s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: file.key
        })).catch(cleanupError => {
          console.error("Cleanup error:", cleanupError);
        })
      ));
    }

    res.status(500).json({
      success: false,
      error: "Failed to update ad"
    });
  }
};

// Export with proper middleware chaining
module.exports = {
  uploadAd: [upload.array("images", 5), exports.uploadAd],
  getAds: exports.getAds,
  deleteAd: exports.deleteAd,
  updateAd: [upload.array("images", 5), exports.updateAd]
};
