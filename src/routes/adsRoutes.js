const express = require("express");
const router = express.Router();
const adsController = require("../controllers/adsController");

// Upload ad (uses multer middleware from controller)
router.post("/:type", adsController.uploadAd);

// Get ads by type
router.get("/:type", adsController.getAds);

// Delete ad by ID
router.delete("/:id", adsController.deleteAd);

// Update ad by ID (uses multer middleware from controller)
router.put("/:id", adsController.updateAd);

module.exports = router;
