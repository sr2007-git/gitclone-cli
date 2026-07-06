let serverApp: any = null;

export default async function handler(req: any, res: any) {
  try {
    if (!serverApp) {
      const module = await import('../server');
      serverApp = module.default || module;
    }
    return serverApp(req, res);
  } catch (err: any) {
    console.error('Failed to import server module:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize the VCS backend server on Vercel.',
      error: err?.message || String(err),
      stack: err?.stack
    });
  }
}
