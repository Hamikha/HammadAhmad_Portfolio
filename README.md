# Hammad Ahmad: personal site

Personal homepage of Hammad Ahmad, M.S. student and Graduate Research Assistant in the Department of Biosystems Engineering at Auburn University.

**Live:** https://hamikha.github.io/HammadAhmad_Portfolio/

## Built with

Plain HTML and one CSS file. No JavaScript, no framework, no build step, no third-party requests. Fonts (Newsreader and Public Sans, SIL Open Font License) are self-hosted.

## Run locally

The site is served from the `/HammadAhmad_Portfolio/` subpath on GitHub Pages. To preview it under the same path, serve the folder that contains this repo:

```bash
cd ..
python -m http.server 8000
```

Then open http://localhost:8000/HammadAhmad_Portfolio/.

## Structure

```
index.html          the page
404.html            not-found page (uses <base> so it works at any depth)
*.html              redirects from the old multi-page site to the matching section
assets/css/         stylesheet
assets/fonts/       woff2 fonts and their licenses
assets/img/         headshot and Open Graph image
favicon.svg         monogram favicon
robots.txt, sitemap.xml
```
