const express = require("express");
const router = express.Router();
const adsController = require("../controllers/adsController");
const { validateAdType } = require("../middleware/validators");

// API versioning prefix
router.use("/api/v1/ads", router);

// Ads routes with controller middleware
router.post("/:type", 
  validateAdType, 
  adsController.uploadAd
);

router.get("/:type", 
  validateAdType, 
  adsController.getAds
);

router.delete("/:id", 
  adsController.deleteAd
);

router.put("/:id", 
  adsController.updateAd
);

module.exports = router;
