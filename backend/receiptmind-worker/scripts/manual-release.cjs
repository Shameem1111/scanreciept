// Wrangler runs this before upload, including when invoked directly by Workers Builds.
if (process.env.WORKERS_CI || process.env.WORKERS_CI_COMMIT_SHA || process.env.CI) {
  console.error('Automatic deployment is disabled. Follow DEPLOYMENT.md from a local operator shell.');
  process.exit(1);
}
