document.addEventListener('DOMContentLoaded', function() {
  const calendar = document.getElementById('calendar-dates');
  const monthYearDisplay = document.getElementById('month-year');
  const eventList = document.getElementById('event-list');
  const currentMonthSpan = document.getElementById('current-month');
  const prevMonthBtn = document.getElementById('prev-month');
  const nextMonthBtn = document.getElementById('next-month');

  let currentDate = new Date();
  let events = [];

  function renderCalendar() {
      // Clear the previous calendar
      calendar.innerHTML = '';

      // Set current month and year display
      const month = currentDate.getMonth();
      const year = currentDate.getFullYear();
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      monthYearDisplay.textContent = `${monthNames[month]} ${year}`;
      currentMonthSpan.textContent = monthNames[month];

      // Get first day and number of days in current month
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      // Add empty divs for days of the previous month
      for (let i = 0; i < firstDay; i++) {
          const emptyDiv = document.createElement('div');
          calendar.appendChild(emptyDiv);
      }

      // Add days of the month
      for (let day = 1; day <= daysInMonth; day++) {
          const dateDiv = document.createElement('div');
          dateDiv.textContent = day;
          dateDiv.classList.add('calendar-date');

          const event = events.find(e => new Date(e.event_date).getDate() === day && new Date(e.event_date).getMonth() === month);
          if (event) {
              dateDiv.classList.add('has-event');
              dateDiv.addEventListener('click', () => displayEventDetails(event));
          }

          calendar.appendChild(dateDiv);
      }
  }
 
 

  function displayEventDetails(event) {
      eventList.innerHTML = `
          <div class="event">
             
              <h2>${event.title}</h2>
              <p>${event.description}</p>
              <p>Event Date: ${new Date(event.event_date).toLocaleDateString()}</p>
             <p>Event Picture:</p>
                <div class="gallery-item">
                   <img src="/public/uploads/${event.picture}"  alt="Event Picture" onclick="openLightbox(this)">
              </div>
          </div>
      `;
  }



  function fetchEvents() {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1; // MySQL uses 1-based index for months
      fetch(`/api/events/${year}/${month}`)
          .then(response => response.json())
          .then(data => {
              events = data;
              renderCalendar();
          });
  }

  // Handle previous and next month buttons
  prevMonthBtn.addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() - 1);
      fetchEvents();
  });

  nextMonthBtn.addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() + 1);
      fetchEvents();
  });

  // Initial render
  fetchEvents();
});



function openLightbox(imgElement) {
    const lightbox = document.getElementById("lightbox");
    const lightboxImage = document.getElementById("lightbox-image");
    lightboxImage.src = imgElement.src;
    lightbox.style.display = "flex";
}

function closeLightbox() {
    document.getElementById("lightbox").style.display = "none";
}
