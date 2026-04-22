<?php

namespace Database\Seeders;

use App\Models\Service;
use App\Models\SiteSetting;
use Illuminate\Database\Seeder;

class SiteSettingSeeder extends Seeder
{
    public function run(): void
    {
        // ── Hero Section ──────────────────────────────────────────────────────────
        SiteSetting::set('hero_title', "FABRICATION &\nMANUFACTURING\nRESEARCH CENTER");
        SiteSetting::set('hero_bg_type', 'color');           // 'color' or 'image'
        SiteSetting::set('hero_bg_color', '#8b1a1a');
        SiteSetting::set('hero_bg_image', null);
        SiteSetting::set('hero_logo_image', null);           // base64 or null (falls back to /images/FMRC Logo.png)

        // ── About Us Section ──────────────────────────────────────────────────────
        SiteSetting::set('about_heading', 'ABOUT US');
        SiteSetting::set('about_text_1', 'The Fabrication and Manufacturing Research Center (FMRC) is <strong>a state-of-the-art shared service facility that bridges creativity and technology.</strong> It empowers students, educators, researchers, and businesses to transform innovative ideas into practical and functional outputs.');
        SiteSetting::set('about_text_2', 'FMRC serves as a Shared Service Facility of the <strong>Department of Trade and Industry (DTI)</strong> and a Common Service Facility of <strong>Camarines Norte State College (CNSC)</strong>. It supports Micro, Small, and Medium Enterprises (MSMEs) by enhancing creativity, design, and business innovation while increasing productivity and efficiency.');
        SiteSetting::set('about_video_url', '/images/Product showcase.mp4');

        // ── Vision Section ────────────────────────────────────────────────────────
        SiteSetting::set('vision_heading', 'OUR VISION');
        SiteSetting::set('vision_text', 'CNSC FMRC as a leading manufacturing and fabrication laboratory in the Bicol Region.');
        SiteSetting::set('vision_image', null);              // base64 or null (falls back to /images/pic1.jpg)

        // ── Mission Section ───────────────────────────────────────────────────────
        SiteSetting::set('mission_heading', 'OUR MISSION');
        SiteSetting::set('mission_text', 'CNSC FMRC shall provide an avenue for creative thinking and artistic design/work among its clientele using advanced technology means.');
        SiteSetting::set('mission_image', null);             // base64 or null (falls back to /images/pic2.jpg)

        // ── Contact Section ───────────────────────────────────────────────────────
        SiteSetting::set('contact_heading', 'Get in Touch');
        SiteSetting::set('contact_lead', 'Our customer service team is ready to help with your inquiries, project requests, and service concerns. Reach out through any of the channels below.');
        SiteSetting::set('contact_location', 'First Flr., Graduate School Building, Camarines Norte State College, Daet, Philippines');
        SiteSetting::set('contact_location_url', 'https://www.google.com/maps/search/?api=1&query=Camarines+Norte+State+College,+Daet,+Philippines');
        SiteSetting::set('contact_email', 'fmrc@cnsc.edu.ph');
        SiteSetting::set('contact_phone', '0909-099-0000');
        SiteSetting::set('contact_facebook', 'CNSC FMRC');
        SiteSetting::set('contact_facebook_url', 'https://www.facebook.com/share/18MJcUvJeM/');
        SiteSetting::set('contact_form_heading', 'Send Us a Message');
        SiteSetting::set('contact_form_subtitle', '');

        // ── Footer Section ────────────────────────────────────────────────────────
        SiteSetting::set('footer_brand_name', 'CNSC- FMRC');
        SiteSetting::set('footer_brand_desc', 'Fabrication and Manufacturing Research Center - Advancing innovation through technology and excellence in manufacturing.');
        SiteSetting::set('footer_quick_links', json_encode([
            ['label' => 'Home',     'url' => '/home-page/main.html'],
            ['label' => 'About Us', 'url' => '/home-page/main.html#about'],
            ['label' => 'Services', 'url' => '/services-page/service.html'],
            ['label' => 'Products', 'url' => '/products-page/product.html'],
            ['label' => 'Contact',  'url' => '/contact-page/contact.html'],
        ]));
        SiteSetting::set('footer_hours_days', 'Monday - Friday');
        SiteSetting::set('footer_hours_time', '7:00am - 6:00pm');
        SiteSetting::set('footer_contact_location', 'First Flr., Graduate School Building, Camarines Norte State College, Daet, Philippines');
        SiteSetting::set('footer_contact_location_url', 'https://www.google.com/maps/search/?api=1&query=Camarines+Norte+State+College,+Daet,+Philippines');
        SiteSetting::set('footer_contact_email', 'fmrc@cnsc.edu.ph');
        SiteSetting::set('footer_contact_phone', '0909-099-0000');
        SiteSetting::set('footer_contact_facebook', 'CNSC FMRC');
        SiteSetting::set('footer_contact_facebook_url', 'https://www.facebook.com/share/18MJcUvJeM/');
        SiteSetting::set('footer_copyright', '© 2026 CNSC Fabrication and Manufacturing Research Center. All rights reserved.');

        // ── Seed Default Services ─────────────────────────────────────────────────
        $services = [
            ['title' => '3D Printing',                    'category' => 'Prototyping',         'description' => 'High-quality rapid prototyping using FDM and SLA technology.',                          'modal_description' => 'Get precise, professional results with our state-of-the-art 3D printing facility. We cater to students, researchers, and local businesses.', 'modal_features' => ['FDM & SLA technology','Multiple material support','High precision output','Rapid turnaround'],       'modal_materials' => ['PLA & ABS Filament','Resin (SLA)','Flexible TPU'],           'modal_best_for' => ['Prototypes','Scale models','Custom parts'],                'sort_order' => 1],
            ['title' => '3D Scanning',                    'category' => 'Prototyping',         'description' => 'Accurate digital recreation of physical objects for reverse engineering.',               'modal_description' => 'Capture precise 3D measurements of physical objects for digital reproduction, reverse engineering, or quality inspection.',            'modal_features' => ['High-resolution scanning','Point cloud output','Mesh generation','Portable scanner'],             'modal_materials' => ['Any solid object','Up to 1m in size'],                       'modal_best_for' => ['Reverse engineering','Quality control','Digital archiving'], 'sort_order' => 2],
            ['title' => 'Heatpress',                      'category' => 'Manufacturing',       'description' => 'Professional heat transfer printing for shirts, mugs, and custom materials.',           'modal_description' => 'Produce vibrant, durable heat-pressed designs on a variety of substrates for uniforms, merchandise, and promotional items.',          'modal_features' => ['Full-color printing','Durable transfer','Various substrates','Fast turnaround'],                  'modal_materials' => ['T-shirts & polo','Mugs & ceramic','Tote bags','Mouse pads'], 'modal_best_for' => ['Uniforms','Souvenirs','Promotional items'],                 'sort_order' => 3],
            ['title' => 'CNC Milling',                    'category' => 'Manufacturing',       'description' => 'Computer-controlled shaping for wood, plastics, and soft metals.',                      'modal_description' => 'Precision CNC milling for custom parts, molds, and signage from a wide range of materials.',                                         'modal_features' => ['High-precision cuts','Multiple materials','Custom toolpaths','CAD/CAM ready'],                     'modal_materials' => ['Wood / MDF / Plywood','Aluminum','Plastics & foam'],          'modal_best_for' => ['Custom molds','Signage','Mechanical parts'],                 'sort_order' => 4],
            ['title' => 'CNC Router',                     'category' => 'Manufacturing',       'description' => 'Precision routing for signages, panels, molds, and larger wood projects.',             'modal_description' => 'Large-format CNC routing for signs, furniture panels, decorative carvings, and custom wood products.',                               'modal_features' => ['Large-format cutting','High-speed routing','Custom designs','Intricate details'],                 'modal_materials' => ['Plywood / MDF','Acrylic sheets','Foam boards'],              'modal_best_for' => ['Signage','Furniture panels','Decorative carvings'],          'sort_order' => 5],
            ['title' => 'Laser Cutting and Engraving',    'category' => 'Manufacturing',       'description' => 'Precision laser services on wood, acrylic, leather, and selected metals.',             'modal_description' => 'Achieve fine detail and clean edges with our laser cutting and engraving service for a wide range of materials.',                    'modal_features' => ['Multiple material support','High precision cuts','Rapid prototyping','Cost-effective'],           'modal_materials' => ['Acrylic & Plastics','Wood / MDF / Plywood','Leather & Textiles'],'modal_best_for' => ['Signage and nameplates','Keychains and souvenirs','Prototypes and craft projects'],'sort_order' => 6],
            ['title' => 'Digital Embroidery',             'category' => 'Manufacturing',       'description' => 'Automated stitching for uniforms, patches, and textile branding needs.',               'modal_description' => 'High-quality machine embroidery for logos, patches, and custom textile designs with precise stitch placement.',                     'modal_features' => ['Multi-color stitching','Logo digitizing','Fast production','Durable finish'],                     'modal_materials' => ['Polo shirts & uniforms','Caps & hats','Fabric patches'],     'modal_best_for' => ['Corporate uniforms','School uniforms','Branded merchandise'],'sort_order' => 7],
            ['title' => 'Large Format Printing and Cutting','category' => 'Design and Labelling','description' => 'Tarpaulins, vinyl stickers, and large-scale poster printing services.',            'modal_description' => 'Wide-format inkjet printing for banners, tarpaulins, vehicle wraps, and large promotional materials.',                               'modal_features' => ['Wide-format output','UV-resistant inks','Precision cutter','Indoor & outdoor use'],               'modal_materials' => ['Tarpaulin','Vinyl sticker','Canvas','Photo paper'],           'modal_best_for' => ['Event banners','Vehicle wraps','Storefront signage'],         'sort_order' => 8],
            ['title' => 'Prototyping',                    'category' => 'Prototyping',         'description' => 'End-to-end prototype development from concept design to functional model.',             'modal_description' => 'Full-cycle prototyping service from ideation and CAD design to fabrication and finishing for any industry.',                        'modal_features' => ['Concept to model','Multi-material','Functional testing','Short runs'],                            'modal_materials' => ['Plastics','Metals','Composites'],                            'modal_best_for' => ['Product development','Engineering projects','Startup MVPs'],  'sort_order' => 9],
            ['title' => 'Product Labeling and Designing', 'category' => 'Design and Labelling','description' => 'Professional branding, logo creation, and label layout for packaging.',               'modal_description' => 'Complete graphic design and print-ready label production for products, packaging, and branding.',                                   'modal_features' => ['Custom logo design','Print-ready files','Brand guidelines','Various sizes'],                      'modal_materials' => ['Sticker labels','Box inserts','Packaging materials'],         'modal_best_for' => ['MSMEs','Food packaging','Product launches'],                  'sort_order' => 10],
            ['title' => 'Project Consultation',           'category' => 'Training and Workshops','description' => 'Technical guidance for fabrication workflow, materials, and costing plans.',         'modal_description' => 'One-on-one expert consultation for your fabrication and manufacturing project needs, from design to production planning.',            'modal_features' => ['Expert advice','Costing estimates','Material selection','Workflow planning'],                     'modal_materials' => ['All material types'],                                        'modal_best_for' => ['MSMEs','Students & researchers','Business owners'],           'sort_order' => 11],
            ['title' => 'Partnership',                    'category' => 'Training and Workshops','description' => 'Collaborative programs with schools, communities, and industries.',                 'modal_description' => 'Formal collaboration agreements for shared facilities, joint research, training programs, and community extension projects.',         'modal_features' => ['MOA/MOU support','Joint programs','Resource sharing','Community impact'],                          'modal_materials' => ['N/A'],                                                       'modal_best_for' => ['Academic institutions','LGUs','Industry partners'],           'sort_order' => 12],
            ['title' => 'Training Workshop Tour',         'category' => 'Training and Workshops','description' => 'Structured learning sessions, demos, and guided facility tours.',                  'modal_description' => 'Hands-on training workshops and guided tours of FMRC facilities for students, professionals, and community groups.',                'modal_features' => ['Live demonstrations','Hands-on sessions','Expert facilitators','Certificate of participation'],  'modal_materials' => ['N/A'],                                                       'modal_best_for' => ['Students','Educators','Community groups'],                    'sort_order' => 13],
        ];

        foreach ($services as $svc) {
            Service::firstOrCreate(['title' => $svc['title']], $svc);
        }
    }
}
