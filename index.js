const express = require('express');
const app = express();

// Middlewares
app.use(express.json());

// Mount Grow A Garden API
const growAGardenRouter = require('./grow-a-garden/index');
app.use('/grow-a-garden', growAGardenRouter);

const discordRouter = require('./discord/index');
app.use('/discord', discordRouter);

const appRouter = require('./app/index');
app.use('/app', appRouter);

//----------------------//----------------------//

// Root health check
app.get('/', (req, res) => {
  res.send('✅ API root: api.sflightx.com');
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🌐 API server running at http://localhost:${PORT}`);
});
