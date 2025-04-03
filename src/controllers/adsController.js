const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const multerS3 = require("multer-s3");
const path = require("path");
const multer = require("multer");
const Ad = require("../models/Ad");

// Configure AWS S3
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Multer-S3 configuration
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
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 5 // Max 5 files
  }
});

// Helper function to get full image URL
const getImageUrl = (imageKey) =>
  imageKey ? `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${imageKey}` : null;

// Upload Ads, Banners, or Banner1
const uploadAd = async (req, res) => {
  try {
    console.log("Uploading files...", req.files);
    const { type } = req.params;
    
    if (!["ads", "banner", "banner1"].includes(type)) {
      return res.status(400).json({ error: "Invalid type. Must be 'ads', 'banner', or 'banner1'" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const imageKeys = req.files.map((file) => file.key);
    const ad = new Ad({ images: imageKeys, type });
    await ad.save();

    res.status(201).json({ 
      message: `${type} uploaded successfully!`, 
      ad: {
        ...ad.toObject(),
        images: ad.images.map(imageKey => getImageUrl(imageKey))
      }
    });
  } catch (error) {
    console.error("Error uploading ad:", error);
    res.status(500).json({ 
      error: "Failed to upload image.",
      details: error.message 
    });
  }
};

// Fetch Ads, Banners, or Banner1
const getAds = async (req, res) => {
  try {
    const { type } = req.params;
    const ads = await Ad.find({ type }).sort({ createdAt: -1 });

    const adsWithUrls = ads.map((ad) => ({
      ...ad.toObject(),
      images: ad.images.map((imageKey) => getImageUrl(imageKey)),
    }));

    res.json(adsWithUrls);
  } catch (error) {
    console.error("Error fetching ads:", error);
    res.status(500).json({ 
      error: "Failed to fetch ads.",
      details: error.message
    });
  }
};

// Delete an Ad, Banner, or Banner1
const deleteAd = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ error: "Ad not found" });
    }

    // Delete images from S3
    const deletePromises = ad.images.map(imageKey => 
      s3.send(new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: imageKey,
      }))
    );
    
    await Promise.all(deletePromises);
    await ad.deleteOne();

    res.json({ message: "Ad deleted successfully!" });
  } catch (error) {
    console.error("Error deleting ad:", error);
    res.status(500).json({ 
      error: "Failed to delete ad.",
      details: error.message
    });
  }
};

// Update an Ad, Banner, or Banner1
const updateAd = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ error: "Ad not found" });
    }

    // Delete old images from S3 if new files are uploaded
    if (req.files && req.files.length > 0) {
      const deletePromises = ad.images.map(imageKey => 
        s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: imageKey,
        }))
      );
      await Promise.all(deletePromises);

      // Update with new images
      ad.images = req.files.map((file) => file.key);
      await ad.save();
    }

    res.json({ 
      message: "Ad updated successfully!", 
      updatedAd: {
        ...ad.toObject(),
        images: ad.images.map(imageKey => getImageUrl(imageKey))
      }
    });
  } catch (error) {
    console.error("Error updating ad:", error);
    res.status(500).json({ 
      error: "Failed to update ad.",
      details: error.message
    });
  }
};

module.exports = {
  uploadAd: [upload.array("images"), uploadAd],
  getAds,
  deleteAd,
  updateAd: [upload.array("images"), updateAd],
};
