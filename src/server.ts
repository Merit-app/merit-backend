import 'dotenv/config';

const PORT = process.env.PORT || 3001;

async function start() {
  const { app } = await import('./app');
  app.listen(PORT, () => {
    console.log(`listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
