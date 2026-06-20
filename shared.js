// Shared sidebar HTML
const sidebarHTML = `
  <div class="profile-pic"></div>
  <h2>Hammad Ahmad</h2>
  <p class="title">AI Engineer</p>
  <div class="availability-badge">Available for work</div>
  <div class="sidebar-meta">
    <div class="meta-item"><span class="meta-icon">📍</span> Islamabad, Pakistan</div>
    <div class="meta-item"><span class="meta-icon">✉️</span> hamikhan273@gmail.com</div>
    <div class="meta-item"><span class="meta-icon">📞</span> +92 308 0468982</div>
  </div>
  <ul class="contact-links">
    <li><a href="https://www.linkedin.com/in/hammad-ahmad-b91ba0247" target="_blank">🔗 LinkedIn</a></li>
    <li><a href="https://github.com/Hamikha" target="_blank">🐙 GitHub</a></li>
    <li><a href="mailto:hamikhan273@gmail.com">📧 Email</a></li>
  </ul>
`;

// Inject sidebar
document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.innerHTML = sidebarHTML;

  // Mark active nav link
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.main-nav a').forEach(a => {
    if (a.getAttribute('href') === path) a.classList.add('active');
  });
});
