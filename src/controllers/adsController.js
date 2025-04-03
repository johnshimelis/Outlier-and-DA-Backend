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

// Multer configuration for S3
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_BUCKET_NAME,
    acl: 'public-read',
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const fileName = `ads/${Date.now()}${ext}`;
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

const getImageUrl = (imageKey) => {
  return imageKey 
    ? `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${imageKey}`
    : null;
};

// Upload Ads
exports.uploadAd = async (req, res) => {
  try {
    const { type } = req.params;
    if (!["ads", "banner", "banner1"].includes(type)) {
      return res.status(400).json({ error: "Invalid type" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const imageKeys = req.files.map((file) => file.key);
    const ad = new Ad({ images: imageKeys, type });
    await ad.save();

    res.status(201).json({
      message: `${type} uploaded successfully`,
      ad: {
        ...ad.toObject(),
        images: ad.images.map(getImageUrl)
      }
    });
  } catch (error) {
    console.error("Upload error:", error);
    
    // Cleanup uploaded files if error occurred
    if (req.files?.length > 0) {
      await Promise.all(req.files.map(file => 
        s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: file.key
        })).catch(cleanupError => {
          console.error("Cleanup error:", cleanupError);
        })
      );
    }

    res.status(500).json({ error: error.message || "Upload failed" });
  }
};

// Get Ads
exports.getAds = async (req, res) => {
  try {
    const { type } = req.params;
    const ads = await Ad.find({ type });

    res.json(ads.map(ad => ({
      ...ad.toObject(),
      images: ad.images.map(getImageUrl)
    })));
  } catch (error) {
    console.error("Fetch error:", error);
    res.status(500).json({ error: "Failed to fetch ads" });
  }
};

// Delete Ad
exports.deleteAd = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ error: "Ad not found" });
    }

    await Promise.all([
      ...ad.images.map(imageKey => 
        s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: imageKey
        }))
      ),
      ad.deleteOne()
    ]);

    res.json({ message: "Deleted successfully" });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ error: "Failed to delete ad" });
  }
};

// Update Ad
exports.updateAd = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ error: "Ad not found" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const oldImages = [...ad.images];
    const newImageKeys = req.files.map((file) => file.key);
    
    ad.images = newImageKeys;
    await ad.save();

    // Cleanup old images
    await Promise.all(oldImages.map(imageKey =>
      s3.send(new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: imageKey
      }))
    ));

    res.json({
      message: "Updated successfully",
      updatedAd: {
        ...ad.toObject(),
        images: ad.images.map(getImageUrl)
      }
    });
  } catch (error) {
    console.error("Update error:", error);
    
    // Cleanup new files if error occurred
    if (req.files?.length > 0) {
      await Promise.all(req.files.map(file =>
        s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: file.key
        }))
      );
    }

    res.status(500).json({ error: "Failed to update ad" });
  }
};

module.exports = {
  uploadAd: [upload.array("images", 5), exports.uploadAd],
  getAds: exports.getAds,
  deleteAd: exports.deleteAd,
  updateAd: [upload.array("images", 5), exports.updateAd]
};
