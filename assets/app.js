// Configuration - UPDATE THIS with your R2 public URL
const CONFIG = {
  r2PublicUrl: "https://pub-b1b3bdad9e3742a7a323d65bf8f0436a.r2.dev",
  mappingsUrl: "../data/mappings.json",
};

// Source labels for display
const SOURCE_LABELS = {
  whatsapp: "Fotos via WhatsApp",
  pro: "Fotos Pro",
};

// R2 prefixes per source
const SOURCE_PREFIXES = {
  whatsapp: "party-whatsapp",
  pro: "party-pro",
};

let currentPhotos = [];
let currentPrefix = "party";
let currentIndex = 0;

async function init() {
  const params = new URLSearchParams(window.location.search);
  const guestId = params.get("id");
  const source = params.get("source"); // "whatsapp" or "pro"

  if (!guestId) {
    showError("No se encontro el ID del album. Verifica el link que te mandaron.");
    return;
  }

  // Set source label
  const sourceLabel = document.getElementById("source-label");
  if (sourceLabel && source && SOURCE_LABELS[source]) {
    sourceLabel.textContent = SOURCE_LABELS[source];
  }

  // Set R2 prefix based on source
  if (source && SOURCE_PREFIXES[source]) {
    currentPrefix = SOURCE_PREFIXES[source];
  }

  showLoading(true);

  try {
    const response = await fetch(CONFIG.mappingsUrl);
    if (!response.ok) throw new Error("No se pudieron cargar los datos");

    const data = await response.json();
    const guestData = data.guest_to_photos[guestId];

    // Support both old format (flat array) and new format (object with whatsapp/pro keys)
    let photos;
    if (!guestData) {
      photos = [];
    } else if (Array.isArray(guestData)) {
      // Old format: flat array of photo IDs
      photos = guestData;
    } else if (typeof guestData === "object") {
      // New format: { whatsapp: [...], pro: [...] }
      if (source && guestData[source]) {
        photos = guestData[source];
      } else {
        // No source specified or source not found: show all
        photos = [
          ...(guestData.whatsapp || []),
          ...(guestData.pro || []),
        ];
      }
    }

    if (!photos || photos.length === 0) {
      showError("No encontramos fotos tuyas todavia. Volve a intentar mas tarde.");
      return;
    }

    // Extract guest name from ID (reverse the slug)
    const guestName = guestId
      .replace(/-[a-f0-9]{6}$/, "") // remove hash
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    document.getElementById("guest-name").textContent = guestName;
    document.getElementById("photo-count").textContent = `${photos.length} fotos`;

    currentPhotos = photos;
    renderPhotoGrid(photos);
  } catch (error) {
    console.error("Error:", error);
    showError("Error al cargar el album. Intenta de nuevo mas tarde.");
  } finally {
    showLoading(false);
  }
}

function renderPhotoGrid(photos) {
  const grid = document.getElementById("photo-grid");
  grid.innerHTML = "";

  photos.forEach((photoId, index) => {
    const item = document.createElement("div");
    item.className = "photo-item";

    const img = document.createElement("img");
    img.dataset.src = `${CONFIG.r2PublicUrl}/${currentPrefix}/${photoId}.jpg`;
    img.alt = `Foto ${index + 1}`;
    img.loading = "lazy";

    img.addEventListener("load", () => img.classList.add("loaded"));
    img.addEventListener("click", () => openLightbox(index));

    item.appendChild(img);
    grid.appendChild(item);
  });

  // Intersection Observer for lazy loading
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute("data-src");
            observer.unobserve(img);
          }
        }
      });
    },
    { rootMargin: "200px" }
  );

  grid.querySelectorAll("img[data-src]").forEach((img) => observer.observe(img));
}

// Lightbox
function openLightbox(index) {
  currentIndex = index;
  const lightbox = document.getElementById("lightbox");
  const img = document.getElementById("lightbox-img");
  const counter = document.getElementById("lightbox-counter");

  img.src = `${CONFIG.r2PublicUrl}/${currentPrefix}/${currentPhotos[index]}.jpg`;
  counter.textContent = `${index + 1} / ${currentPhotos.length}`;
  lightbox.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  document.getElementById("lightbox").classList.remove("active");
  document.body.style.overflow = "";
}

function navigateLightbox(direction) {
  currentIndex = (currentIndex + direction + currentPhotos.length) % currentPhotos.length;
  const img = document.getElementById("lightbox-img");
  const counter = document.getElementById("lightbox-counter");

  img.src = `${CONFIG.r2PublicUrl}/${currentPrefix}/${currentPhotos[currentIndex]}.jpg`;
  counter.textContent = `${currentIndex + 1} / ${currentPhotos.length}`;
}

// Keyboard navigation
document.addEventListener("keydown", (e) => {
  const lightbox = document.getElementById("lightbox");
  if (!lightbox.classList.contains("active")) return;

  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") navigateLightbox(-1);
  if (e.key === "ArrowRight") navigateLightbox(1);
});

// Touch swipe for mobile
let touchStartX = 0;
document.addEventListener("touchstart", (e) => {
  touchStartX = e.changedTouches[0].screenX;
});

document.addEventListener("touchend", (e) => {
  const lightbox = document.getElementById("lightbox");
  if (!lightbox.classList.contains("active")) return;

  const diff = e.changedTouches[0].screenX - touchStartX;
  if (Math.abs(diff) > 50) {
    navigateLightbox(diff > 0 ? -1 : 1);
  }
});

function showLoading(show) {
  document.getElementById("loading").style.display = show ? "flex" : "none";
}

function showError(message) {
  const el = document.getElementById("error");
  el.textContent = message;
  el.style.display = "block";
}

document.addEventListener("DOMContentLoaded", init);
