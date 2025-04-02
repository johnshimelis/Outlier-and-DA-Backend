const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3"); // AWS SDK v3
const multerS3 = require("multer-s3");
const path = require("path");
const multer = require("multer");
const Ad = require("../models/Ad"); // Import the Ad model

// Configure AWS S3 (SDK v3)
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Multer configuration for S3 (SDK v3)
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_BUCKET_NAME,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const fileName = `${Date.now()}${ext}`;
      cb(null, fileName);
    },
  }),
  fileFilter: (req, file, cb) => {
    file.mimetype.startsWith("image/") ? cb(null, true) : cb(new Error("Only image files are allowed!"), false);
  },
});

// Helper function to get full image URL
const getImageUrl = (imageKey) =>
  imageKey ? `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${imageKey}` : null;

// Upload Ads, Banners, or Banner1
exports.uploadAd = async (req, res) => {
  try {
    const { type } = req.params;
    if (!["ads", "banner", "banner1"].includes(type)) {
      return res.status(400).json({ error: "Invalid type" });
    }

    const imageKeys = req.files.map((file) => file.key); // Store S3 keys instead of local paths
    const ad = new Ad({ images: imageKeys, type });
    await ad.save();

    res.json({ message: `${type} uploaded successfully!`, ad });
  } catch (error) {
    console.error("Error uploading ad:", error);
    res.status(500).json({ error: "Failed to upload image." });
  }
};

// Fetch Ads, Banners, or Banner1
exports.getAds = async (req, res) => {
  try {
    const { type } = req.params;
    const ads = await Ad.find({ type });

    // Map ads to include full image URLs
    const adsWithUrls = ads.map((ad) => ({
      ...ad.toObject(),
      images: ad.images.map((imageKey) => getImageUrl(imageKey)),
    }));

    res.json(adsWithUrls);
  } catch (error) {
    console.error("Error fetching ads:", error);
    res.status(500).json({ error: "Failed to fetch ads." });
  }
};

// Delete an Ad, Banner, or Banner1
exports.deleteAd = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ error: "Ad not found" });
    }

    // Delete images from S3
    for (const imageKey of ad.images) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: imageKey,
        })
      );
    }

    await ad.deleteOne();
    res.json({ message: "Deleted successfully!" });
  } catch (error) {
    console.error("Error deleting ad:", error);
    res.status(500).json({ error: "Failed to delete ad." });
  }
};

// Update an Ad, Banner, or Banner1
exports.updateAd = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ error: "Ad not found" });
    }

    // Delete old images from S3
    for (const imageKey of ad.images) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: imageKey,
        })
      );
    }

    // Upload new images and store their keys
    const newImageKeys = req.files.map((file) => file.key);
    ad.images = newImageKeys;
    await ad.save();

    res.json({ message: "Updated successfully!", updatedAd: ad });
  } catch (error) {
    console.error("Error updating ad:", error);
    res.status(500).json({ error: "Failed to update ad." });
  }
};

module.exports = {
  uploadAd: [upload.array("images"), exports.uploadAd], // Use multer middleware for file uploads
  getAds: exports.getAds,
  deleteAd: exports.deleteAd,
  updateAd: [upload.array("images"), exports.updateAd], // Use multer middleware for file uploads
};