const chatButton = document.querySelector('.floating-whatsapp');
const chatWidget = document.getElementById('whatsapp-chat-widget');
const closeButton = document.querySelector('.chat-close');
const chatForm = document.getElementById('whatsapp-chat-form');
const chatBody = document.getElementById('whatsapp-chat-body');
const chatText = document.getElementById('whatsapp-chat-text');

const whatsappNumber = '918087909448';

function openChat() {
  chatWidget.classList.add('active');
  chatWidget.setAttribute('aria-hidden', 'false');
  chatText.focus();
}

function closeChat() {
  chatWidget.classList.remove('active');
  chatWidget.setAttribute('aria-hidden', 'true');
}

function addMessage(text, type) {
  const message = document.createElement('div');
  message.className = `chat-message ${type}`;
  message.innerHTML = `<p>${text}</p><span>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
  chatBody.appendChild(message);
  chatBody.scrollTop = chatBody.scrollHeight;
}

chatButton.addEventListener('click', openChat);
closeButton.addEventListener('click', closeChat);

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = chatText.value.trim();
  if (!text) return;

  addMessage(text, 'outgoing');
  chatText.value = '';

  setTimeout(() => {
    addMessage('Sure! Tap the button below to continue on WhatsApp.', 'incoming');
    const redirectButton = document.createElement('button');
    redirectButton.type = 'button';
    redirectButton.className = 'chat-redirect';
    redirectButton.textContent = 'Continue on WhatsApp';
    redirectButton.addEventListener('click', () => {
      window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`, '_blank');
    });
    const wrapper = document.createElement('div');
    wrapper.style.marginTop = '0.75rem';
    wrapper.appendChild(redirectButton);
    chatBody.appendChild(wrapper);
    chatBody.scrollTop = chatBody.scrollHeight;
  }, 600);
});
