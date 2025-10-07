const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  res.json({ message: "🤖 Discord API online!" });
});

module.exports = router;