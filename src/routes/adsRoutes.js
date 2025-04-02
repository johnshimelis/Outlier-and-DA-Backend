const express = require("express");
const multer = require("multer");
const router = express.Router();
const adsController = require("../controllers/adsController");

// Multer Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

// Routes
router.post("/:type", upload.array("images", 5), adsController.uploadAd);
router.get("/:type", adsController.getAds);
router.delete("/:id", adsController.deleteAd);
router.put("/:id", upload.array("images", 5), adsController.updateAd);

module.exports = router;
