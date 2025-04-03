const { S3Client, DeleteObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const multerS3 = require("multer-s3");
const path = require("path");
const multer = require("multer");
const Ad = require("../models/Ad");

// Configure AWS S3 with error handling
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Enhanced file filter
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed!"), false);
  }
};

// Multer configuration with better error handling
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_BUCKET_NAME,
    acl: 'public-read', // Ensure files are publicly accessible
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const fileName = `ads/${Date.now()}${ext}`;
      cb(null, fileName);
    },
    contentType: multerS3.AUTO_CONTENT_TYPE,
  }),
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 5 // Max 5 files per upload
  }
});

// Helper function to get full image URL
const getImageUrl = (imageKey) => {
  if (!imageKey) return null;
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${imageKey}`;
};

// Upload Ads, Banners, or Banner1 with better error handling
exports.uploadAd = async (req, res) => {
  try {
    const { type } = req.params;
    
    // Validate type
    if (!["ads", "banner", "banner1"].includes(type)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid type. Must be one of: ads, banner, banner1" 
      });
    }

    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: "No files were uploaded" 
      });
    }

    // Create new ad document
    const imageKeys = req.files.map(file => file.key);
    const ad = new Ad({ 
      images: imageKeys, 
      type,
      createdAt: new Date()
    });

    await ad.save();

    // Return response with full URLs
    const responseAd = {
      ...ad.toObject(),
      images: ad.images.map(imageKey => getImageUrl(imageKey))
    };

    res.status(201).json({
      success: true,
      message: `${type} uploaded successfully!`,
      ad: responseAd
    });

  } catch (error) {
    console.error("Error uploading ad:", error);
    
    // Cleanup uploaded files if error occurred
    if (req.files && req.files.length > 0) {
      await Promise.all(req.files.map(file => {
        return s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: file.key
        })).catch(cleanupError => {
          console.error("Error cleaning up file:", cleanupError);
        });
      }));
    }

    res.status(500).json({ 
      success: false,
      error: error.message || "Failed to upload image(s)" 
    });
  }
};

// Update an Ad, Banner, or Banner1 with better error handling
exports.updateAd = async (req, res) => {
  try {
    const { id } = req.params;

    // Find existing ad
    const ad = await Ad.findById(id);
    if (!ad) {
      return res.status(404).json({ 
        success: false,
        error: "Ad not found" 
      });
    }

    // Check if new files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: "No new files were uploaded for update" 
      });
    }

    // Delete old images from S3
    await Promise.all(ad.images.map(imageKey => {
      return s3.send(new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: imageKey
      })).catch(deleteError => {
        console.error("Error deleting old image:", deleteError);
      });
    }));

    // Update with new images
    const newImageKeys = req.files.map(file => file.key);
    ad.images = newImageKeys;
    ad.updatedAt = new Date();
    await ad.save();

    // Return response with full URLs
    const responseAd = {
      ...ad.toObject(),
      images: ad.images.map(imageKey => getImageUrl(imageKey))
    };

    res.json({
      success: true,
      message: "Ad updated successfully!",
      updatedAd: responseAd
    });

  } catch (error) {
    console.error("Error updating ad:", error);
    
    // Cleanup newly uploaded files if error occurred
    if (req.files && req.files.length > 0) {
      await Promise.all(req.files.map(file => {
        return s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: file.key
        })).catch(cleanupError => {
          console.error("Error cleaning up file:", cleanupError);
        });
      }));
    }

    res.status(500).json({ 
      success: false,
      error: error.message || "Failed to update ad" 
    });
  }
};

// Other controller methods remain the same...

module.exports = {
  uploadAd: [upload.array("images", 5), exports.uploadAd], // Limit to 5 images
  getAds: exports.getAds,
  deleteAd: exports.deleteAd,
  updateAd: [upload.array("images", 5), exports.updateAd], // Limit to 5 images
};
