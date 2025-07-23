const express = require('express');
const app = express();

// Middlewares
app.use(express.json());

// Mount Grow A Garden API
const growAGardenRouter = require('./grow-a-garden/index');
app.use('/grow-a-garden', growAGardenRouter);

// Mount other APIs here
// const anotherApiRouter = require('./another-api/index');
// app.use('/another-api', anotherApiRouter);

// Root health check
app.get('/', (req, res) => {
  res.send('✅ API root: api.sflightx.com');
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🌐 API server running at http://localhost:${PORT}`);
});
