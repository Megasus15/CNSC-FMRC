/**
 * services.js — Customer Services Page
 * Renders skeleton loading state first, then populates services dynamically.
 * Handles search and category filtering.
 */
document.addEventListener("DOMContentLoaded", () => {
  const servicesGrid = document.getElementById("servicesGrid");
  const searchInput = document.querySelector(".products-toolbar .search-input");
  const categorySelect = document.querySelector(".products-toolbar .category-select");

  const servicesData = [
    {
      id: 1,
      title: "3D Printing",
      category: "prototyping",
      chip: "Prototyping",
      img: "/images/3dprint.jpg",
      desc: "High-quality rapid prototyping using FDM and SLA technology."
    },
    {
      id: 2,
      title: "3D Scanning",
      category: "prototyping",
      chip: "Prototyping",
      img: "/images/3dscan.jpg",
      desc: "Accurate digital recreation of physical objects for reverse engineering."
    },
    {
      id: 3,
      title: "Heatpress",
      category: "manufacturing",
      chip: "Manufacturing",
      img: "/images/heatpress.jpg",
      desc: "Professional heat transfer printing for shirts, mugs, and custom materials."
    },
    {
      id: 4,
      title: "CNC Milling",
      category: "manufacturing",
      chip: "Manufacturing",
      img: "/images/cnc.jpg",
      desc: "Computer-controlled shaping for wood, plastics, and soft metals."
    },
    {
      id: 5,
      title: "CNC Router",
      category: "manufacturing",
      chip: "Manufacturing",
      img: "/images/pic2.jpg",
      desc: "Precision routing for signages, panels, molds, and larger wood projects."
    },
    {
      id: 6,
      title: "Laser Cutting",
      category: "manufacturing",
      chip: "Manufacturing",
      img: "/images/laser.jpg",
      desc: "High-precision vector cutting and engraving for acrylics and wood."
    },
    {
      id: 7,
      title: "PCB Milling",
      category: "manufacturing",
      chip: "Manufacturing",
      img: "/images/pcbmilling.jpg",
      desc: "Rapid circuit board prototyping without chemical etching."
    },
    {
      id: 8,
      title: "Vinyl Cutting",
      category: "design",
      chip: "Design & Labelling",
      img: "/images/vinylcutter.jpg",
      desc: "Precision vinyl decal cutting for stickers, logos, and custom labels."
    }
  ];

  // Render Skeleton Loading
  const renderSkeleton = () => {
    if (!servicesGrid) return;
    servicesGrid.innerHTML = Array.from({ length: 8 }).map(() => `
      <div class="service-card skeleton-card">
        <div class="card-img-holder skeleton-img"></div>
        <div class="card-content">
          <div class="skeleton-text" style="width:35%;height:14px;border-radius:999px;"></div>
          <div class="skeleton-text" style="width:75%;height:20px;margin-top:6px;border-radius:6px;"></div>
          <div class="skeleton-text" style="width:95%;height:14px;margin-top:6px;border-radius:4px;"></div>
          <div class="skeleton-text" style="width:90%;height:14px;margin-top:4px;border-radius:4px;"></div>
        </div>
      </div>
    `).join("");
  };

  // Render Service Cards
  const renderServices = (items) => {
    if (!servicesGrid) return;
    if (!items.length) {
      servicesGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align:center; padding: 50px 20px; color: #6d7480; font-weight:700;">No services found matching your search.</div>`;
      return;
    }

    servicesGrid.innerHTML = items.map(item => `
      <article class="service-card" data-category="${item.category}">
        <div class="card-img-holder">
          <img src="${item.img}" alt="${item.title}" loading="lazy" />
        </div>
        <div class="card-content">
          <span class="service-chip">${item.chip}</span>
          <h3 class="card-title">${item.title}</h3>
          <p class="card-desc">${item.desc}</p>
          <button class="details-btn open-modal-btn">
            View service details
          </button>
        </div>
      </article>
    `).join("");
  };

  // Filter & Search
  const filterServices = () => {
    const query = (searchInput?.value || "").toLowerCase().trim();
    const cat = categorySelect?.value || "all";

    let filtered = servicesData;
    if (cat !== "all") {
      filtered = filtered.filter(s => s.category === cat);
    }
    if (query) {
      filtered = filtered.filter(s =>
        s.title.toLowerCase().includes(query) ||
        s.desc.toLowerCase().includes(query) ||
        s.chip.toLowerCase().includes(query)
      );
    }

    renderServices(filtered);
  };

  // Initial Load with Skeleton Effect
  renderSkeleton();
  setTimeout(() => {
    renderServices(servicesData);
  }, 400);

  searchInput?.addEventListener("input", filterServices);
  categorySelect?.addEventListener("change", filterServices);
});
