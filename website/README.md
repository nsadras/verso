# Verso website

The minimal landing page for **https://thinkwithverso.com**. This is a standalone Next.js project: all source, assets, dependencies, and build settings live in `website/`.

## Local development

Use Node.js 24 and npm. From the repository root:

```bash
cd website
npm ci
npm run dev
```

Open http://localhost:3000. For a production check:

```bash
npm run build
npm run typecheck
npm start
```

The website does not need the Python backend, a model server, or files from the parent application to build or run.

## Vercel

Import this repository as a separate Vercel project with these settings:

| Setting | Value |
| --- | --- |
| Root Directory | `website` |
| Framework Preset | Next.js |
| Node.js Version | 24.x |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | Leave at the Next.js default |

No environment variables or external-directory access are required. After deployment, add `thinkwithverso.com` under the project's Domains settings and use the DNS records Vercel supplies. This project serves the public landing page; the notebook application continues to run separately.

Vercel documents selecting a project's root directory in its [monorepo guide](https://vercel.com/docs/monorepos).

## Editing

- `app/page.tsx`: introduction, philosophy, capabilities, and installation link.
- `app/site.ts`: canonical domain, metadata, and repository URL.
- `app/components/`: navigation and footer.
- `app/global.css`: the narrow reading layout, typography, and system light/dark themes.
- `public/images/verso-notebook.png`: a screenshot of the real app with an illustrative conversation and notes, captured against a separate temporary database. The original image opens from the page for a closer look.
- `app/opengraph-image.tsx`: the sharing card. The sitemap, robots file, and canonical URL point to `thinkwithverso.com`.

Geist fonts are served from the installed package, so builds do not fetch fonts from Google. The page has no analytics, signup form, or model calls.

## Template attribution

Adapted from Vercel's [Portfolio Blog Starter](https://github.com/vercel/examples/tree/a4b4827297bec79b81ddb2ff22a53089ebe88cd8/solutions/blog), the source of [the requested demo](https://portfolio-blog-starter.vercel.app/). The template's layout, typography, navigation, footer, and metadata structure form the starting point. The sample posts, MDX/RSS utilities, analytics, and syntax-highlighting dependencies are omitted for this single-page site; framework and styling dependencies use current stable releases.

The upstream MIT notice is preserved in [LICENSE.template.md](LICENSE.template.md). It applies to the reused template code and is not a new license declaration for the parent Verso application.
