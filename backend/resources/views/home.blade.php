<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CNSC - FMRC Landing Page</title>

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;700;800&family=Open+Sans:wght@400;600;700&display=swap"
      rel="stylesheet"
    />

    <link rel="stylesheet" href="{{ asset('frontend/home-page/main.css') }}" />
  </head>
  <body>
    <header class="site-header">
      <a href="main.html" class="logo-container">
        <img
          src="/images/CNSC logo.png"
          alt="CNSC Logo"
          class="header-emblem"
        />
        <h1 class="logo-text">CNSC-FMRC</h1>
      </a>

      <nav class="main-nav">
        <ul>
          <li><a href="main.html#home" class="nav-link active">Home</a></li>
          <li><a href="#about" class="nav-link">About Us</a></li>
          <li>
            <a href="/services-page/service.html" class="nav-link">Services</a>
          </li>
          <li>
            <a href="/products-page/product.html" class="nav-link">Products</a>
          </li>
          <li><a href="/contact-page/contact.html" class="nav-link">Contact</a></li>
        </ul>
      </nav>

      <div class="header-right-actions">
        <div class="user-profile" title="My Account">
          <svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="20" cy="20" r="20" fill="#C0392B" />
            <path
              d="M20 20C23.3137 20 26 17.3137 26 14C26 10.6863 23.3137 8 20 8C16.6863 8 14 10.6863 14 14C14 17.3137 16.6863 20 20 20ZM20 23C15.5817 23 6.66669 25.2386 6.66669 29.6667V32H33.3334V29.6667C33.3334 25.2386 24.4183 23 20 23Z"
              fill="white"
            />
          </svg>
        </div>
      </div>
    </header>

    <main class="hero-section" id="home">
      <div class="hero-container">
        <div class="hero-content-left">
          <h2 class="hero-title">
            FABRICATION &<br />
            MANUFACTURING<br />
            <span class="hero-research-line">RESEARCH CENTER</span>
          </h2>

          <div class="hero-buttons">
            <a href="/products-page/product.html" class="btn-browse"
              >Browse Products</a
            >
            <button class="btn-appointment">Appoint Now!</button>
          </div>
        </div>

        <div class="hero-content-right">
          <img
            src="/images/FMRC Logo.png"
            alt="FMRC Geometric Logo"
            class="hero-graphic"
          />
        </div>
      </div>

      <a href="#about" class="scroll-indicator">
        <span class="scroll-text">Scroll Down</span>
        <svg
          class="scroll-icon"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      </a>
    </main>

    <section id="about" class="about-wrapper">
      <div class="about-section">
        <div class="about-container">
          <div class="about-content-left">
            <h2 class="section-title">ABOUT US</h2>
            <p class="section-text">
              The Fabrication and Manufacturing Research Center (FMRC) is
              <strong
                >a state-of-the-art shared service facility that bridges
                creativity and technology.</strong
              >
              It empowers students, educators, researchers, and businesses to
              transform innovative ideas into practical and functional outputs.
            </p>
            <p class="section-text">
              FMRC serves as a Shared Service Facility of the
              <strong>Department of Trade and Industry (DTI)</strong> and a
              Common Service Facility of
              <strong>Camarines Norte State College (CNSC)</strong>. It supports
              Micro, Small, and Medium Enterprises (MSMEs) by enhancing
              creativity, design, and business innovation while increasing
              productivity and efficiency.
            </p>
          </div>

          <div class="about-content-right">
            <div class="about-video-holder" id="aboutVideoHolder" aria-label="About video holder">
              <video
                class="about-preview-video"
                id="aboutPreviewVideo"
                preload="metadata"
                muted
                playsinline
              >
                <source src="/images/Product showcase.mp4" type="video/mp4" />
              </video>
              <button
                class="about-video-control"
                id="aboutVideoToggle"
                type="button"
                aria-label="Play or pause preview video"
              >
                ▶
              </button>
            </div>

            <div class="about-video-modal" id="aboutVideoModal">
              <button class="about-video-close" id="aboutVideoClose" aria-label="Close video">
                &times;
              </button>
              <div class="about-video-modal-box">
                <video class="about-full-video" id="aboutFullVideo" controls playsinline>
                  <source src="/images/Product showcase.mp4" type="video/mp4" />
                </video>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="vision-section">
        <div class="vision-container">
          <div class="vision-content-left">
            <img src="/images/pic1.jpg" alt="FMRC Vision" class="vision-img" />
          </div>
          <div class="vision-content-right">
            <h2 class="vm-title">OUR VISION</h2>
            <p class="vm-text">
              CNSC FMRC as a leading manufacturing and fabrication laboratory in
              the Bicol Region.
            </p>
          </div>
        </div>
      </div>

      <div class="mission-section">
        <div class="mission-container">
          <div class="mission-content-left">
            <h2 class="vm-title">OUR MISSION</h2>
            <p class="vm-text">
              CNSC FMRC shall provide an avenue for creative thinking and
              artistic design/work among its clientele using advanced technology
              means.
            </p>
          </div>
          <div class="mission-content-right">
            <div class="blob-wrapper">
              <img
                src="/images/pic2.jpg"
                alt="FMRC Mission"
                class="mission-img"
              />
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="services-preview" class="services-preview-section">
      <div class="services-container">
        <h2
          class="section-title"
          style="text-align: center; margin-bottom: 50px"
        >
          wHAT WE OFFER
        </h2>

        <div class="carousel-wrapper landscape-carousel">
          <button class="carousel-btn prev-btn" aria-label="Previous Service">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>

          <div class="carousel-track">
            <div class="carousel-item">
              <div class="service-card landscape-card">
                <div class="card-img-holder">
                  <img src="/images/3dprint.jpg" alt="3D Printing" />
                </div>
                <div class="card-content">
                  <h3 class="card-title">3D Printing</h3>
                  <p class="card-desc">
                    High-quality rapid prototyping using FDM and SLA tech.
                  </p>
                </div>
              </div>
            </div>

            <div class="carousel-item">
              <div class="service-card landscape-card">
                <div class="card-img-holder">
                  <img src="/images/3dscan.jpg" alt="3D Scanning" />
                </div>
                <div class="card-content">
                  <h3 class="card-title">3D Scanning</h3>
                  <p class="card-desc">
                    Accurate digital recreation of physical objects for reverse
                    engineering.
                  </p>
                </div>
              </div>
            </div>

            <div class="carousel-item">
              <div class="service-card landscape-card">
                <div class="card-img-holder">
                  <img src="/images/pic1.jpg" alt="Heatpress" />
                </div>
                <div class="card-content">
                  <h3 class="card-title">Heatpress</h3>
                  <p class="card-desc">
                    Professional heat transfer printing for shirts, mugs, and
                    customized promotional materials.
                  </p>
                </div>
              </div>
            </div>

            <div class="carousel-item">
              <div class="service-card landscape-card">
                <div class="card-img-holder">
                  <img src="/images/cnc.jpg" alt="CNC Milling" />
                </div>
                <div class="card-content">
                  <h3 class="card-title">CNC Milling</h3>
                  <p class="card-desc">
                    Computer-controlled shaping for wood, plastics, and soft
                    metals.
                  </p>
                </div>
              </div>
            </div>

            <div class="carousel-item">
              <div class="service-card landscape-card">
                <div class="card-img-holder">
                  <img src="/images/pic2.jpg" alt="CNC Router" />
                </div>
                <div class="card-content">
                  <h3 class="card-title">CNC Router</h3>
                  <p class="card-desc">
                    Precision routing for signages, panels, molds, and larger
                    wood or acrylic projects.
                  </p>
                </div>
              </div>
            </div>

            <div class="carousel-item">
              <div class="service-card landscape-card">
                <div class="card-img-holder">
                  <img src="/images/laser-cutting.png" alt="Laser Cutting and Engraving" />
                </div>
                <div class="card-content">
                  <h3 class="card-title">Laser Cutting and Engraving</h3>
                  <p class="card-desc">
                    Precision laser services on wood, acrylic, leather, and
                    metals.
                  </p>
                </div>
              </div>
            </div>

            <div class="carousel-item">
              <div class="service-card landscape-card">
                <div class="card-img-holder">
                  <img src="/images/pic1.jpg" alt="Digital Embroidery" />
                </div>
                <div class="card-content">
                  <h3 class="card-title">Digital Embroidery</h3>
                  <p class="card-desc">
                    Automated stitching for uniforms, patches, logos, and
                    textile branding applications.
                  </p>
                </div>
              </div>
            </div>

            <div class="carousel-item">
              <div class="service-card landscape-card">
                <div class="card-img-holder">
                  <img src="/images/largeformat.jpg" alt="Large Format Printing and Cutting" />
                </div>
                <div class="card-content">
                  <h3 class="card-title">Large Format Printing and Cutting</h3>
                  <p class="card-desc">
                    Tarpaulins, vinyl stickers, and large-scale poster printing.
                  </p>
                </div>
              </div>
            </div>

            <div class="carousel-item">
              <div class="service-card landscape-card">
                <div class="card-img-holder">
                  <img src="/images/pic2.jpg" alt="Prototyping" />
                </div>
                <div class="card-content">
                  <h3 class="card-title">Prototyping</h3>
                  <p class="card-desc">
                    End-to-end prototype development support from concept design
                    to initial functional model.
                  </p>
                </div>
              </div>
            </div>

            <div class="carousel-item">
              <div class="service-card landscape-card">
                <div class="card-img-holder">
                  <img src="/images/labelling.jpg" alt="Product Labeling and Designing" />
                </div>
                <div class="card-content">
                  <h3 class="card-title">Product Labeling and Designing</h3>
                  <p class="card-desc">
                    Professional branding, logo creation, and product label
                    layout for market-ready packaging.
                  </p>
                </div>
              </div>
            </div>

            <div class="carousel-item">
              <div class="service-card landscape-card">
                <div class="card-img-holder">
                  <img src="/images/pic1.jpg" alt="Project Consultation" />
                </div>
                <div class="card-content">
                  <h3 class="card-title">Project Consultation</h3>
                  <p class="card-desc">
                    Technical guidance for fabrication workflows, materials,
                    costing, and project planning.
                  </p>
                </div>
              </div>
            </div>

            <div class="carousel-item">
              <div class="service-card landscape-card">
                <div class="card-img-holder">
                  <img src="/images/pic2.jpg" alt="Partnership" />
                </div>
                <div class="card-content">
                  <h3 class="card-title">Partnership</h3>
                  <p class="card-desc">
                    Collaborative programs with institutions, communities, and
                    industries for innovation initiatives.
                  </p>
                </div>
              </div>
            </div>

            <div class="carousel-item">
              <div class="service-card landscape-card">
                <div class="card-img-holder">
                  <img src="/images/pic1.jpg" alt="Training Workshop Tour" />
                </div>
                <div class="card-content">
                  <h3 class="card-title">Training/Workshop/Tour</h3>
                  <p class="card-desc">
                    Structured learning sessions, laboratory demonstrations, and
                    guided facility tours.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <button class="carousel-btn next-btn" aria-label="Next Service">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>

        <div class="view-all-container">
          <a href="/services-page/service.html" class="view-all-btn"
            >View All Services</a
          >
        </div>
      </div>
    </section>

    <div class="apt-overlay" id="appointmentFlow">
      <div class="apt-container">
        <div class="apt-header-top">
          <button
            class="apt-back-btn"
            id="closeAppointmentBtn"
            title="Back to Homepage"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h2 class="apt-main-title">Set an Appointment</h2>
          <div style="width: 32px"></div>
        </div>

        <div class="apt-progress-wrapper">
          <div class="apt-step active" id="stepIndicator1">
            <span class="step-label">STEP 1</span>
            <div class="apt-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <span>Reminders</span>
          </div>
          <div class="apt-line"></div>
          <div class="apt-step" id="stepIndicator2">
            <span class="step-label">STEP 2</span>
            <div class="apt-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
            <span>Information</span>
          </div>
          <div class="apt-line"></div>
          <div class="apt-step" id="stepIndicator3">
            <span class="step-label">STEP 3</span>
            <div class="apt-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
            </div>
            <span>Appointment</span>
          </div>
          <div class="apt-line"></div>
          <div class="apt-step" id="stepIndicator4">
            <span class="step-label">STEP 4</span>
            <div class="apt-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                ></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <circle cx="10" cy="13" r="2"></circle>
                <line x1="11.4" y1="14.4" x2="15" y2="18"></line>
              </svg>
            </div>
            <span>Review</span>
          </div>
          <div class="apt-line"></div>
          <div class="apt-step" id="stepIndicator5">
            <span class="step-label">STEP 5</span>
            <div class="apt-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
            </div>
            <span>Completed</span>
          </div>
        </div>

        <div class="apt-content-section active" id="aptStep1">
          <div class="apt-card">
              <div class="apt-card-header">
                  <h3>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="12" y1="8" x2="12" y2="12"></line>
                          <line x1="12" y1="16" x2="12.01" y2="16"></line>
                      </svg>
                      Important Reminders
                  </h3>
              </div>
              <div class="apt-reminders-grid">
                <div class="apt-reminder-item">
                    <div class="apt-reminder-icon">1</div>
                    <div class="apt-reminder-content">
                        <h4>Data Privacy Collection</h4>
                        <p>At Camarines Norte State College, we value your privacy. In compliance with RA 10173, we collect:</p>
                        <ol class="apt-reminder-list" style="margin-top:10px;">
                            <li>Email & Contact Details</li>
                            <li>Client Type & Department</li>
                            <li>Service Request & Schedule</li>
                        </ol>
                    </div>
                </div>
                <div class="apt-reminder-item">
                    <div class="apt-reminder-icon">2</div>
                    <div class="apt-reminder-content">
                        <h4>Appointment Policy</h4>
                        <p>To ensure organized service:</p>
                        <ul class="apt-reminder-list" style="margin-top:10px; list-style: disc; margin-left: 15px;">
                            <li>All clients are required to book online.</li>
                            <li>Walk-ins may not be accommodated immediately.</li>
                            <li>Please arrive on time for your scheduled slot.</li>
                        </ul>
                    </div>
                </div>
              </div>
          </div>
          <div class="apt-footer-actions">
            <button class="apt-btn apt-btn-blue" id="btnGoToPrivacy">
              I Understand, Proceed
            </button>
          </div>
        </div>

        <div class="apt-content-section" id="aptStep2">
          <div class="apt-card apt-form-card">
            <div class="apt-form-grid">
              
              <!-- Section 1: Personal Info -->
              <div class="apt-form-header">
                  <h4>Personal Information</h4>
              </div>

              <div class="apt-input-group">
                <label>Last Name</label>
                <input type="text" id="aptLName" class="c-input" placeholder="e.g. Dela Cruz" maxlength="20"/>
              </div>
              <div class="apt-input-group">
                <label>First Name</label>
                <input type="text" id="aptFName" class="c-input" placeholder="e.g. Juan" maxlength="25"/>
              </div>
              <div class="apt-input-group">
                <label>M.I. (Optional)</label>
                <input type="text" id="aptMI" class="c-input" placeholder="M" maxlength="1"/>
              </div>

              <div class="apt-input-group">
                <label>Mobile Number</label>
                <input type="tel" id="aptPhone" class="c-input" placeholder="09xxxxxxxxx" maxlength="11" inputmode="numeric"/>
              </div>
              <div class="apt-input-group" style="grid-column: span 2">
                <label>Email Address</label>
                <input type="email" id="aptEmail" class="c-input" placeholder="example@gmail.com"/>
              </div>

              <!-- Section 2: Address -->
              <div class="apt-form-header">
                  <h4>Residential Address</h4>
              </div>

              <div class="apt-input-group">
                <label>Country</label>
                <select id="aptCountry" class="c-input">
                  <option value="Philippines" selected>Philippines</option>
                  <option value="Outside Philippines">Other Country</option>
                </select>
              </div>

              <div id="aptPhAddressFields" style="display: contents;">
                <div class="apt-input-group">
                  <label>Region</label>
                  <select id="aptRegion" class="c-input">
                    <option value="" selected disabled hidden>Select Region</option>
                  </select>
                </div>

                <div class="apt-input-group">
                  <label>Province</label>
                  <select id="aptProvince" class="c-input" disabled>
                    <option value="" selected disabled hidden>Select Province</option>
                  </select>
                </div>

                <div class="apt-input-group">
                  <label>Municipality</label>
                  <select id="aptMunicipality" class="c-input" disabled>
                    <option value="" selected disabled hidden>Select Municipality</option>
                  </select>
                </div>

                <div class="apt-input-group">
                  <label>Barangay</label>
                  <select id="aptAddress" class="c-input" disabled>
                    <option value="" selected disabled hidden>Select Barangay</option>
                  </select>
                </div>
              </div>

              <div class="apt-input-group" id="aptIntlAddressField" style="display: none; grid-column: span 3;">
                <label>Complete Residential Address</label>
                <textarea id="aptIntlAddress" class="c-input" rows="3" placeholder="Enter your full address (street, city/state, postal code, country)"></textarea>
              </div>

              <!-- Section 3: Appointment Details -->
              <div class="apt-form-header">
                  <h4>Appointment Details</h4>
              </div>

              <div class="apt-input-group" style="grid-column: span 2">
                <label>Purpose of Visit</label>
                <select id="aptPurpose" class="c-input">
                  <option value="" disabled selected hidden>Select Service Request</option>
                  <option value="Product labelling and designing">Product labelling and designing</option>
                  <option value="3D Printing">3D Printing</option>
                  <option value="3D Scanning">3D Scanning</option>
                  <option value="Laser-cutting/engraving">Laser-cutting/engraving</option>
                  <option value="Large Format printing & cutting">Large Format printing & cutting</option>
                  <option value="CNC Milling">CNC Milling</option>
                  <option value="Inquiries">Inquiries</option>
                </select>
                
                <div class="file-upload-wrapper" style="margin-top: 10px;">
                    <div class="file-upload-icon">+</div>
                  <span class="file-upload-text" id="aptFileLabel">Click to Attach Design File (Optional)</span>
                  <small id="aptFileName" style="font-size: 11px; color: #7a7a7a; margin-top: 4px; text-align: center;">No file selected</small>
                  <input type="file" id="aptFile" accept="image/*,.pdf,.doc,.docx" style="position: absolute; width: 100%; height: 100%; opacity: 0; cursor: pointer;">
                </div>
              </div>

              <div class="apt-input-group">
                <label>Type of Client</label>
                <select class="c-input" id="aptRole">
                  <option value="" disabled selected hidden>Select Type</option>
                  <option value="Student">Student</option>
                  <option value="Researchers">Researchers</option>
                  <option value="Business">Business</option>
                  <option value="Association">Association</option>
                  <option value="Educators">Educators</option>
                </select>
              </div>

              <div class="apt-input-group" style="grid-column: span 3">
                <label>Additional Description / Notes</label>
                <textarea id="aptDesc" class="c-input apt-fixed-scroll-textarea" rows="3" placeholder="Please describe your request in detail..."></textarea>
              </div>
            </div>
          </div>
          <div class="apt-footer-actions">
            <button class="apt-btn apt-btn-back" id="btnCancelTo1">Back</button>
            <button class="apt-btn apt-btn-blue" id="btnGoToStep3">
              Proceed to Schedule
            </button>
          </div>
        </div>

        <div class="apt-content-section" id="aptStep3">
          <div class="apt-card apt-calendar-card">
            <div class="calendar-header-text">
              <h3>Select Date & Time</h3>
              <p>
                Please select a date from the calendar below. Then, choose your preferred time slot on the right. 
                <br>
                <strong>Note:</strong> Weekends (Saturday & Sunday) are unavailable. Past dates are disabled. You can select only 1 time slot per day.
              </p>
            </div>

            <div class="apt-calendar-wrapper">
              <!-- Left Side: Calendar -->
              <div class="apt-calendar-left">
                <div class="cal-navigation">
                  <button id="calPrevBtn" type="button">&lt;</button>
                  <h4 id="calMonthYear">September 2023</h4>
                  <button id="calNextBtn" type="button">&gt;</button>
                </div>
                
                <div class="cal-days-header">
                  <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
                </div>
                
                <div class="cal-days-grid" id="calDaysGrid">
                  <!-- JS generated days -->
                </div>

                <div class="cal-legend">
                   <div class="leg-item">
                     <div class="leg-circle leg-am"></div>
                     <span>AM Selected</span>
                   </div>
                   <div class="leg-item">
                     <div class="leg-circle leg-pm"></div>
                     <span>PM Selected</span>
                   </div>
                   <div class="leg-item">
                     <div class="leg-circle leg-full"></div>
                     <span>AM & PM Selected</span>
                   </div>
                   <div class="leg-item">
                     <div class="leg-box leg-unavailable"></div>
                     <span>Unavailable</span>
                   </div>
                </div>
              </div>

              <!-- Right Side: Time Slots -->
              <div class="apt-time-right">
                <h4 id="selectedDateDisplay">Select a Date</h4>
                <div id="userDateEventsDisplay" class="date-note-card" aria-live="polite"></div>
                <div class="slot-counter-wrapper" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                  <span id="slotCounter" style="font-size: 13px; font-weight: 600; color: #555; display: none;">Allowed: 1 time slot for this appointment</span>
                </div>
                <div class="time-slots-container" id="timeSlotsContainer">
                  <p class="time-placeholder">Please pick a date first.</p>
                  <!-- JS generated slots -->
                </div>
                <p id="maxLimitMsg" style="color: #b01c1c; font-size: 12px; margin-top: 10px; display: none; font-weight: bold;">
                   This time is disabled because another user already booked this date and time.
                </p>
              </div>
            </div>

          </div>
          <div class="apt-footer-actions">
            <button class="apt-btn apt-btn-back" id="btnCancelTo2">Back</button>
            <button class="apt-btn apt-btn-blue" id="btnGoToConfirm">
              Proceed
            </button>
          </div>
        </div>

        <div class="apt-content-section" id="aptStep4">
          <div class="ticket-container">
          <div class="ticket-header">
            <div>
              <span style="display:block; font-size: 11px; opacity: 0.8; letter-spacing: 1px;">PREVIEW APPOINTMENT</span>
            <h3 id="revTicketNo" style="margin: 5px 0 0; font-size: 24px; font-weight: 800;">Ticket #PENDING</h3>
            </div>
            <div style="text-align: right;">
              <span style="font-size: 12px; font-weight: 600; background: rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 4px;">DRAFT</span>
            </div>
          </div>
            
          <div class="ticket-body">
            <div class="ticket-row">
              <div class="ticket-column">
                <div class="t-label">FULL NAME</div>
                <div class="t-value" id="revName">Kevin Arevalo</div>
              </div>
              <div class="ticket-column">
                <div class="t-label">CONTACT</div>
                <div class="t-value" id="revPhone">09911341158</div>
              </div>
            </div>
                
            <div class="ticket-row">
              <div class="ticket-column">
                <div class="t-label">EMAIL ADDRESS</div>
                <div class="t-value" id="revEmail">kevin@gmail.com</div>
              </div>
              <div class="ticket-column">
                <div class="t-label">HOME ADDRESS</div>
                <div class="t-value" id="revAddress">Masalong, Labo</div>
              </div>
            </div>

            <div class="ticket-row">
              <div class="ticket-column">
                 <div class="t-label">PURPOSE</div>
                <div class="t-value" id="revPurpose">Inquiries</div>
              </div>
              <div class="ticket-column">
              <div class="t-label">TYPE OF CLIENT</div>
              <div class="t-value" id="revClientType">Student</div>
              </div>
            </div>

            <div class="ticket-row">
              <div class="ticket-column">
                <div class="t-label">SCHEDULED DATE & TIME</div>
                <div class="t-value highlight" id="revSched" style="font-size: 18px;">
                  March 13, 2026 @ 9:00 AM
                </div>
              </div>
            </div>

            <div class="ticket-row">
              <div class="ticket-column">
                <div class="t-label">ADDITIONAL NOTES</div>
                <div class="t-value" id="revDesc" style="font-style: italic; color: #666;">Meeting with head...</div>
              </div>
            </div>

            <div class="ticket-row">
              <div class="ticket-column">
              <div class="t-label">ATTACHED FILE</div>
              <div class="t-value" id="revFileAttach">N/A</div>
              </div>
              <div class="ticket-column">
              <div class="t-label">COUNTRY</div>
              <div class="t-value" id="revCountry">Philippines</div>
              </div>
            </div>
          </div>
            
          <!-- Bottom perforated edge visual could be added via CSS if needed -->
          </div>
          <div class="apt-footer-actions" style="margin-top: 20px;">
          <button class="apt-btn apt-btn-back" id="btnCancelTo3">
            Back to Calendar
          </button>
          <button type="button" class="apt-btn apt-btn-blue" id="btnGoToStep5">
            Confirm & Submit
          </button>
          </div>
        </div>

        <div class="apt-content-section" id="aptStep5">
          <div class="ticket-container" id="officialReceiptCard">
            <div class="ticket-header">
                <div>
                    <span style="display:block; font-size: 11px; opacity: 0.8; letter-spacing: 1px;">OFFICIAL RECEIPT</span>
              <h3 id="comTicketNo" style="margin: 5px 0 0; font-size: 24px; font-weight: 800;">Ticket #PENDING</h3>
                </div>
                <div style="text-align: right;">
                    <span style="font-size: 12px; font-weight: 600; background: #4caf50; color: #fff; padding: 4px 10px; border-radius: 4px;">CONFIRMED</span>
                </div>
            </div>
            
          <div class="ticket-body" style="display: flex; gap: 20px; align-items: stretch;">
                <!-- Left Side Details -->
            <div style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
                    <div class="ticket-row">
                        <div class="ticket-column">
                            <div class="t-label">FULL NAME</div>
                            <div class="t-value" id="comName">Kevin Arevalo</div>
                        </div>
                    </div>
                    
                    <div class="ticket-row">
                        <div class="ticket-column">
                             <div class="t-label">PURPOSE</div>
                            <div class="t-value" id="comPurpose">Inquiries</div>
                        </div>
                    </div>

                        <div class="ticket-row">
                          <div class="ticket-column">
                            <div class="t-label">TYPE OF CLIENT</div>
                            <div class="t-value" id="comClientType">Student</div>
                          </div>
                        </div>
    
                    <div class="ticket-row">
                        <div class="ticket-column">
                            <div class="t-label">SCHEDULE</div>
                            <div class="t-value highlight" id="comSched" style="font-size: 16px; color: #333;">
                                March 13, 2026 @ 9:00 AM
                            </div>
                        </div>
                    </div>

                    <div class="ticket-row">
                        <div class="ticket-column">
                            <div class="t-label">CONTACT</div>
                            <div class="t-value" id="comPhone">09911341158</div>
                        </div>
                    </div>

                        <div class="ticket-row">
                          <div class="ticket-column">
                            <div class="t-label">EMAIL</div>
                            <div class="t-value" id="comEmail">kevin@gmail.com</div>
                          </div>
                        </div>

                        <div class="ticket-row">
                          <div class="ticket-column">
                            <div class="t-label">ADDRESS</div>
                            <div class="t-value" id="comAddress">Masalong, Labo</div>
                          </div>
                        </div>

                        <div class="ticket-row">
                          <div class="ticket-column">
                            <div class="t-label">NOTES</div>
                            <div class="t-value" id="comDesc">N/A</div>
                          </div>
                        </div>

                        <div class="ticket-row">
                          <div class="ticket-column">
                            <div class="t-label">ATTACHED FILE</div>
                            <div class="t-value" id="comFileAttach">N/A</div>
                          </div>
                        </div>
                </div>

                <!-- Right Side QR -->
                <div style="width: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center; border-left: 1px dashed #ccc; padding-left: 20px;">
                        <img id="receiptQrImage" src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=FMRC-Appointment" alt="QR Code" style="width: 100%; height: auto; display: block; mix-blend-mode: multiply;">
                        <span style="font-size: 10px; color: #666; margin-top: 5px; text-align: center;">Scan to verify appointment</span>
                        <a id="receiptQrLink" href="#" target="_blank" rel="noopener" style="font-size: 10px; margin-top: 8px; color: #8b0000; text-align: center;">Open verification page</a>
                </div>
            </div>
            
             <!-- Footer Reminder -->
             <div style="background: #f9f9f9; padding: 15px 25px; border-top: 1px dashed #ddd; font-size: 12px; color: #444; line-height: 1.6;">
               <strong>Important:</strong> Please download or screenshot your QR Code and keep your reference number before closing this window.
               Present your QR code at the FMRC office for fast verification of your online appointment.
             </div>
          </div>

          <div class="apt-footer-actions" style="margin-top: 20px;">
            <button class="apt-btn apt-btn-outline" id="btnGenerateReport">
              <span style="margin-right: 5px;">&#128196;</span> Download Receipt
            </button>
            <button class="apt-btn apt-btn-outline apt-btn-qr" id="btnDownloadQr">
              <span style="margin-right: 5px;">&#128247;</span> Download QR Code
            </button>
             <!-- Final Finish triggers Success Modal/Home -->
            <button class="apt-btn apt-btn-blue" id="btnFinishStep5">
              Finish Transaction
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- SUCCESS MODAL OVERLAY -->
    <div class="success-modal-overlay" id="successAppointmentModal">
      <div class="success-modal">
        <button class="success-close-btn" id="btnCloseSuccess">&times;</button>
        <div class="success-icon">&#10004;</div>
        <h2>Appointment Submitted!</h2>
        <p>Your appointment has been successfully submitted. You can now download your QR code and receipt below.</p>
        <div class="success-reference">
          Reference No: <span id="successReferenceNo">FMRC-2024-00001</span>
        </div>
        <div class="success-actions">
          <button class="success-ok-btn" id="btnSuccessDownload">Download QR Code</button>
          <button class="success-ok-btn" id="btnOkSuccess">Okay, Got it!</button>
        </div>
      </div>
    </div>

    <div class="apt-nested-modal" id="aptPrivacyModal">
      <div class="apt-nested-box">
        <div class="nested-icon">!</div>
        <h3>DATA PRIVACY NOTICE</h3>
        <p>
          By entering the CNSC Fabrication and Manufacturing Research Center -
          Online Appointment Form (OAF), you voluntarily agree or allow
          Camarines Norte State College (CNSC) FMRC to collect and record your
          PERSONAL INFORMATION in our systems to process your appointment. Click
          PROCEED only if you agree with our data collection process, otherwise,
          click CANCEL.
        </p>
        <div class="nested-actions">
          <button class="apt-btn apt-btn-cancel" id="cancelPrivacyBtn">
            Cancel
          </button>
          <button class="apt-btn apt-btn-blue" id="acceptPrivacyBtn">
            Proceed
          </button>
        </div>
      </div>
    </div>

    <div class="apt-nested-modal" id="aptConfirmModal">
      <div class="apt-nested-box" style="text-align: center">
        <div class="nested-icon brown-icon">!</div>
        <h3 style="font-size: 24px; margin-bottom: 10px">Confirmation</h3>
        <p style="text-align: center; margin-bottom: 25px">
          Are you sure you want to proceed?
        </p>
        <div class="nested-actions" style="justify-content: center">
          <button class="apt-btn apt-btn-cancel" id="cancelConfirmBtn">
            Cancel
          </button>
          <button class="apt-btn apt-btn-blue" id="acceptConfirmBtn">
            Proceed
          </button>
        </div>
      </div>
    </div>

    <footer class="site-footer" id="contact">
      <div class="footer-container">
        <div class="footer-col brand-col">
          <div class="footer-logo-row">
            <img
              src="/images/CNSC logo.png"
              alt="CNSC Logo"
              class="footer-logo"
            />
            <img
              src="/images/FMRC Logo.png"
              alt="FMRC Logo"
              class="footer-logo"
            />
            <h3 class="footer-brand">CNSC- FMRC</h3>
          </div>
          <p class="footer-desc">
            Fabrication and Manufacturing Research Center - Advancing innovation
            through technology and excellence in manufacturing.
          </p>
        </div>

        <div class="footer-col">
          <h4 class="footer-heading">Quick Links</h4>
          <ul class="footer-menu">
            <li><a href="#home">Home</a></li>
            <li><a href="#about">About Us</a></li>
            <li><a href="/services-page/service.html">Services</a></li>
            <li><a href="/products-page/product.html">Products</a></li>
            <li><a href="/contact-page/contact.html">Contact</a></li>
          </ul>
        </div>

        <div class="footer-col">
          <h4 class="footer-heading">Business Hours</h4>
          <p class="footer-text">Monday - Friday</p>
          <p class="footer-text">7:00am - 6:00pm</p>
        </div>

        <div class="footer-col contact-col">
          <h4 class="footer-heading">Contact Information</h4>
          <ul class="contact-list">
            <li>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="contact-icon"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              <a
                href="https://www.google.com/maps/search/?api=1&query=Camarines+Norte+State+College,+Daet,+Philippines"
                target="_blank"
                class="footer-link"
                >First Flr., Graduate School Building, Camarines Norte State
                College, Daet, Philippines</a
              >
            </li>
            <li>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="contact-icon"
              >
                <path
                  d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
                ></path>
                <polyline points="22,6 12,13 2,6"></polyline>
              </svg>
              <a href="mailto:fmrc@cnsc.edu.ph" class="footer-link"
                >fmrc@cnsc.edu.ph</a
              >
            </li>
            <li>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="contact-icon"
              >
                <path
                  d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
                ></path>
              </svg>
              <a href="tel:+639090990000" class="footer-link">0909-099-0000</a>
            </li>
            <li>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="contact-icon"
              >
                <path
                  d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"
                ></path>
              </svg>
              <a
                href="https://www.facebook.com/share/18MJcUvJeM/"
                target="_blank"
                class="footer-link"
                >CNSC FMRC</a
              >
            </li>
          </ul>
        </div>
      </div>

      <div class="footer-bottom">
        <div class="footer-line"></div>
        <p>
          &copy; 2026 CNSC Fabrication and Manufacturing Research Center. All
          rights reserved.
        </p>
      </div>
    </footer>

    <script src="{{ asset('frontend/home-page/main.js') }}"></script>
  </body>
</html>
