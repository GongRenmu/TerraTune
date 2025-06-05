import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

class GlobeRadio {
    constructor() {
        this.init();
        this.setupEventListeners();
        this.animate();
        this.stations = new Map();
        this.globeScale = 2;
        this.targetScale = 2;
        this.isZooming = false;
        this.favorites = new Set(JSON.parse(localStorage.getItem('favorites') || '[]'));
        this.history = JSON.parse(localStorage.getItem('history') || '[]');
        this.loadZenoStations();
        this.hoveredMarker = null;
        this.infoPopup = null;
        this.cityTzCache = {};
        this.audio = new Audio();
        this.isPlaying = false;
        this.currentLanguage = localStorage.getItem('lang') || 'zh';
    }

    init() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);

        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            45,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.z = 6;

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000);
        const globeContainer = document.getElementById('globe-container');
        console.log('globe-container:', globeContainer);
        this.renderer.domElement && console.log('renderer dom:', this.renderer.domElement);
        globeContainer && globeContainer.appendChild(this.renderer.domElement);

        // Create globe
        const geometry = new THREE.SphereGeometry(2, 64, 64);
        const textureLoader = new THREE.TextureLoader();
        const earthTexture = textureLoader.load('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg');
        const material = new THREE.MeshPhongMaterial({
            map: earthTexture,
            shininess: 5
        });
        this.globe = new THREE.Mesh(geometry, material);
        this.scene.add(this.globe);

        // Restore original lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(5, 3, 5);
        this.scene.add(directionalLight);

        // Add controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.rotateSpeed = 0.5;

        // Create raycaster for click detection
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Create loading indicator
        this.createLoadingIndicator();

        // Create info popup
        this.createInfoPopup();
    }

    createLoadingIndicator() {
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'loading-indicator';
        loadingDiv.style.position = 'fixed';
        loadingDiv.style.top = '20px';
        loadingDiv.style.left = '50%';
        loadingDiv.style.transform = 'translateX(-50%)';
        loadingDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        loadingDiv.style.color = 'white';
        loadingDiv.style.padding = '10px 20px';
        loadingDiv.style.borderRadius = '5px';
        loadingDiv.style.zIndex = '1000';
        loadingDiv.textContent = 'Loading radio data...';
        document.body.appendChild(loadingDiv);
    }

    async loadZenoStations() {
        try {
            // Load local stations.json
            const response = await fetch('stations.json');
            const stationsData = await response.json();

            stationsData.forEach(station => {
                const key = `${station.latitude},${station.longitude}`;
                if (!this.stations.has(key)) {
                    this.stations.set(key, []);
                }
                this.stations.get(key).push(station);
            });

            // Add stations markers on the globe
            this.addStationMarkers();

            // Remove loading indicator
            const loadingIndicator = document.getElementById('loading-indicator');
            if (loadingIndicator) {
                loadingIndicator.remove();
            }

            // Create station list
            this.createStationList();
        } catch (error) {
            console.error('Error loading stations:', error);
            const loadingIndicator = document.getElementById('loading-indicator');
            if (loadingIndicator) {
                loadingIndicator.textContent = 'Loading stations data failed';
                loadingIndicator.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
            }
        }
    }

    addStationMarkers() {
        const markerGeometry = new THREE.SphereGeometry(0.008, 8, 8); // Marker on globe surface
        const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const markerRadius = this.globeScale; // Marker on globe surface
        const markerTipRadius = this.globeScale * 1.025; // Beam end point
        const beamRadius = 0.002; // Thin beam
        const beamMaterial = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.7 });

        this.markerObjects = [];
        this.beamObjects = [];

        this.stations.forEach((stations, coords) => {
            stations.forEach(station => {
                const [lat, lon] = [station.latitude, station.longitude];
                const phi = (90 - lat) * (Math.PI / 180);
                const theta = (lon + 180) * (Math.PI / 180);

                // Marker on globe surface
                const marker = new THREE.Mesh(markerGeometry, markerMaterial.clone());
                marker.position.x = -markerRadius * Math.sin(phi) * Math.cos(theta);
                marker.position.y = markerRadius * Math.cos(phi);
                marker.position.z = markerRadius * Math.sin(phi) * Math.sin(theta);
                marker.userData.station = station;
                marker.userData.originalColor = 0xff0000;
                this.scene.add(marker);
                this.markerObjects.push(marker);

                // Beam
                const start = new THREE.Vector3(
                    -markerRadius * Math.sin(phi) * Math.cos(theta),
                    markerRadius * Math.cos(phi),
                    markerRadius * Math.sin(phi) * Math.sin(theta)
                );
                const end = new THREE.Vector3(
                    -markerTipRadius * Math.sin(phi) * Math.cos(theta),
                    markerTipRadius * Math.cos(phi),
                    markerTipRadius * Math.sin(phi) * Math.sin(theta)
                );
                const beamHeight = start.distanceTo(end);
                // CylinderGeometry default y-axis is height direction
                const beamGeometry = new THREE.CylinderGeometry(beamRadius, beamRadius, beamHeight, 8);
                const beam = new THREE.Mesh(beamGeometry, beamMaterial.clone());
                // Set beam center point in the middle of start and end
                beam.position.copy(start).add(end).multiplyScalar(0.5);
                // Rotate beam to point towards end-start
                beam.lookAt(end);
                beam.rotateX(Math.PI / 2); // Rotate beam to align with start->end direction
                beam.userData.marker = marker; // Let beam know which marker it corresponds to
                this.scene.add(beam);
                this.beamObjects.push({beam, lat, lon});
            });
        });

        if (!this._markerClickListenerAdded) {
            this.renderer.domElement.addEventListener('click', (event) => this.onMarkerClick(event));
            this.renderer.domElement.addEventListener('mousemove', (event) => this.onMarkerHover(event));
            this._markerClickListenerAdded = true;
        }
    }

    onMarkerHover(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        let minDist = Infinity;
        let closestMarker = null;
        // Iterate through all markers to find the closest to mouse
        this.markerObjects.forEach(marker => {
            // Project 3D coordinates to screen
            const pos = marker.position.clone().project(this.camera);
            const screenX = (pos.x + 1) / 2 * rect.width;
            const screenY = (-pos.y + 1) / 2 * rect.height;
            const dist = Math.sqrt((screenX - mouseX) ** 2 + (screenY - mouseY) ** 2);
            if (dist < minDist) {
                minDist = dist;
                closestMarker = marker;
            }
        });
        // Threshold (pixels)
        const threshold = 10;
        // Reset all first
        this.markerObjects.forEach(marker => {
            marker.material.color.setHex(marker.userData.originalColor);
        });
        this.hoveredMarker = null;
        if (closestMarker && minDist < threshold) {
            closestMarker.material.color.setHex(0xffff00);
            this.hoveredMarker = closestMarker;
            this.renderer.domElement.style.cursor = 'pointer';
        } else {
            this.renderer.domElement.style.cursor = 'default';
        }
    }

    onMarkerClick(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(mouse, this.camera);

        // Check interaction with all markers
        const intersects = this.raycaster.intersectObjects(this.markerObjects);
        if (intersects.length > 0) {
            const marker = intersects[0].object;
            const station = marker.userData.station;
            if (station) {
                this.playStation(station);
            }
        }
    }

    setupEventListeners() {
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        document.getElementById('play-pause').addEventListener('click', () => {
            this.togglePlay();
        });
        document.getElementById('volume').addEventListener('input', (e) => {
            this.audio.volume = e.target.value / 100;
        });
        // Favorite button
        document.getElementById('fav-btn').addEventListener('click', () => {
            if (!this.currentStation) return;
            this.toggleFavorite(this.currentStation);
            this.updateFavBtn(this.currentStation);
        });
    }

    toggleFavorite(station) {
        console.log('toggleFavorite', station);
        if (!station || !station.stream_url) return;
        if (this.favorites.has(station.stream_url)) {
            this.favorites.delete(station.stream_url);
        } else {
            this.favorites.add(station.stream_url);
        }
        localStorage.setItem('favorites', JSON.stringify([...this.favorites]));
        this.updateFavBtn(station);
        // If current Tab is favorites, refresh favorites list
        const activeTab = document.querySelector('.station-tab.active');
        if (activeTab && activeTab.dataset.tab === 'fav') {
            const favs = this.markerObjects.filter(m => this.favorites.has(m.userData.station.stream_url)).map(m => ({station: m.userData.station, marker: m}));
            updateStationListSidebar(this, favs, 'fav');
        }
    }

    playStation(station) {
        this.currentStation = station;
        console.log('playStation', station);
        // Show player interface immediately
        document.getElementById('station-name').textContent = station.name;
        document.getElementById('station-location').textContent = `${station.country} - ${station.city}`;
        document.getElementById('radio-player').classList.remove('hidden');
        // Status prompt
        document.getElementById('player-status').textContent = LANG_MAP[this.currentLanguage].loading;
        // Toggle play/pause icon
        this.setPlayPauseIcon(false);
        // Stop current playback
        if (this.audio) {
            this.audio.pause();
            this.audio.src = '';
        }
        // Only change src, don't create new Audio
        this.audio.src = station.stream_url;
        // Add to history
        this.addToHistory(station);
        // Set loading timeout
        const loadTimeout = setTimeout(() => {
            if (!this.isPlaying) {
                document.getElementById('player-status').textContent = LANG_MAP[this.currentLanguage].timeout;
                this.setPlayPauseIcon(false);
            }
        }, 5000);
        // Try to play
        this.audio.play()
            .then(() => {
                clearTimeout(loadTimeout);
                console.log('Playback started successfully');
                this.isPlaying = true;
                document.getElementById('player-status').textContent = '';
                this.setPlayPauseIcon(true);
                // Update favorite button status
                this.updateFavBtn(station);
                updatePlayerLocalTime(station);
            })
            .catch(error => {
                clearTimeout(loadTimeout);
                console.error('Playback failed:', error);
                document.getElementById('player-status').textContent = LANG_MAP[this.currentLanguage].failed;
                this.setPlayPauseIcon(false);
            });
    }

    addToHistory(station) {
        this.history = this.history.filter(s => s.stream_url !== station.stream_url);
        this.history.unshift(station);
        if (this.history.length > 50) {
            this.history.pop();
        }
        localStorage.setItem('history', JSON.stringify(this.history));
    }

    togglePlay() {
        if (this.isPlaying) {
            this.audio.pause();
            this.setPlayPauseIcon(false);
        } else {
            this.audio.play();
            this.setPlayPauseIcon(true);
        }
        this.isPlaying = !this.isPlaying;
    }

    setPlayPauseIcon(isPlaying) {
        const playIcon = document.getElementById('play-icon');
        const pauseIcon = document.getElementById('pause-icon');
        if (isPlaying) {
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'inline';
        } else {
            playIcon.style.display = 'inline';
            pauseIcon.style.display = 'none';
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        // Smooth zoom animation
        if (this.isZooming) {
            const scaleDiff = this.targetScale - this.globeScale;
            if (Math.abs(scaleDiff) > 0.01) {
                this.globeScale += scaleDiff * 0.1; // Smooth transition
                this.globe.scale.set(this.globeScale, this.globeScale, this.globeScale);
                this.updateMarkerPositions();
            } else {
                this.globeScale = this.targetScale;
                this.globe.scale.set(this.globeScale, this.globeScale, this.globeScale);
                this.updateMarkerPositions();
                this.isZooming = false;
            }
        }
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    updateMarkerPositions() {
        if (!this.markerObjects) return;
        const markerRadius = this.globeScale;
        const markerTipRadius = this.globeScale * 1.025;
        this.markerObjects.forEach((marker, i) => {
            const station = marker.userData.station;
            if (!station) return;
            const lat = station.latitude;
            const lon = station.longitude;
            const phi = (90 - lat) * (Math.PI / 180);
            const theta = (lon + 180) * (Math.PI / 180);
            marker.position.x = -markerRadius * Math.sin(phi) * Math.cos(theta);
            marker.position.y = markerRadius * Math.cos(phi);
            marker.position.z = markerRadius * Math.sin(phi) * Math.sin(theta);
            // Update beam
            if (this.beamObjects && this.beamObjects[i]) {
                const beamObj = this.beamObjects[i];
                const start = new THREE.Vector3(
                    -markerRadius * Math.sin(phi) * Math.cos(theta),
                    markerRadius * Math.cos(phi),
                    markerRadius * Math.sin(phi) * Math.sin(theta)
                );
                const end = new THREE.Vector3(
                    -markerTipRadius * Math.sin(phi) * Math.cos(theta),
                    markerTipRadius * Math.cos(phi),
                    markerTipRadius * Math.sin(phi) * Math.sin(theta)
                );
                const beamHeight = start.distanceTo(end);
                beamObj.beam.geometry.dispose();
                beamObj.beam.geometry = new THREE.CylinderGeometry(0.002, 0.002, beamHeight, 8);
                beamObj.beam.position.copy(start).add(end).multiplyScalar(0.5);
                beamObj.beam.lookAt(end);
                beamObj.beam.rotation.x += Math.PI / 2;
            }
        });
    }

    createInfoPopup() {
        const popup = document.createElement('div');
        popup.id = 'station-info-popup';
        popup.style.position = 'fixed';
        popup.style.pointerEvents = 'none';
        popup.style.background = 'rgba(0,0,0,0.85)';
        popup.style.color = '#fff';
        popup.style.padding = '8px 14px';
        popup.style.borderRadius = '6px';
        popup.style.fontSize = '14px';
        popup.style.zIndex = '9999';
        popup.style.display = 'none';
        document.body.appendChild(popup);
        this.infoPopup = popup;
    }

    filterStationsByRegion(continent, country) {
        // 1. Hide all markers and beams first
        if (this.markerObjects) this.markerObjects.forEach(m => m.visible = false);
        if (this.beamObjects) this.beamObjects.forEach(b => b.beam.visible = false);
        // 2. If no continent selected, show all
        if (!continent) {
            if (this.markerObjects) this.markerObjects.forEach(m => m.visible = true);
            if (this.beamObjects) this.beamObjects.forEach(b => b.beam.visible = true);
            updateStationListSidebar(this, null); // Show all stations
            return;
        }
        // 3. Get all countries in the selected continent
        const countries = CONTINENT_COUNTRY_MAP[continent] || [];
        // 4. Iterate through all markers to check if they belong to the selected country
        const filteredStations = [];
        this.markerObjects.forEach((marker, i) => {
            const station = marker.userData.station;
            if (!station) return;
            // Loose matching: ignore case and spaces
            const stationCountry = (station.country || '').toLowerCase().replace(/\s+/g, '');
            let match = false;
            if (country) {
                match = stationCountry === country.toLowerCase().replace(/\s+/g, '');
            } else {
                match = countries.some(c => stationCountry === c.toLowerCase().replace(/\s+/g, ''));
            }
            marker.visible = match;
            if (this.beamObjects && this.beamObjects[i]) this.beamObjects[i].beam.visible = match;
            if (match) filteredStations.push({station, marker});
        });
        updateStationListSidebar(this, filteredStations);
    }

    updateFavBtn(station) {
        const favBtn = document.getElementById('fav-btn');
        console.log('updateFavBtn', station, this.favorites);
        if (!station || !station.stream_url) {
            favBtn.classList.remove('faved');
            favBtn.title = LANG_MAP[this.currentLanguage].fav;
            return;
        }
        if (this.favorites.has(station.stream_url)) {
            favBtn.classList.add('faved');
            favBtn.title = LANG_MAP[this.currentLanguage].fav;
        } else {
            favBtn.classList.remove('faved');
            favBtn.title = LANG_MAP[this.currentLanguage].fav;
        }
    }

    updateStationTime(station) {
        const timeElement = document.getElementById('station-time');
        if (!timeElement) return;

        if (!station.timezone) {
            timeElement.textContent = this.currentLanguage === 'zh' ? 'Unknown' : 
                                    this.currentLanguage === 'en' ? 'Unknown' : 
                                    'Sconosciuto';
            return;
        }

        try {
            const time = new Date().toLocaleTimeString('en-US', {
                timeZone: station.timezone,
                hour12: false,
                hour: '2-digit',
                minute: '2-digit'
            });
            timeElement.textContent = time;
        } catch (error) {
            timeElement.textContent = this.currentLanguage === 'zh' ? 'Unknown' : 
                                    this.currentLanguage === 'en' ? 'Unknown' : 
                                    'Sconosciuto';
        }
    }

    // Play previous station
    playPreviousStation() {
        if (this.history.length > 1) {
            // Get previous station (skip current one being played)
            const previousStation = this.history[1];
            if (previousStation) {
                this.playStation(previousStation);
            }
        }
    }

    // Play random station
    playRandomStation() {
        if (!this.markerObjects || this.markerObjects.length === 0) return;

        // Get all available stations
        const availableStations = this.markerObjects
            .map(marker => marker.userData.station)
            .filter(station => station.stream_url !== this.currentStation?.stream_url);

        if (availableStations.length === 0) return;

        // Randomly select a station
        const randomIndex = Math.floor(Math.random() * availableStations.length);
        this.playStation(availableStations[randomIndex]);
    }

    // Degrees to radians
    toRad(degrees) {
        return degrees * (Math.PI/180);
    }
}

// --- Region filtering logic ---
const CONTINENT_COUNTRY_MAP = {
  'Africa': [
    'Algeria','Angola','Benin','Botswana','Burkina Faso','Burundi','Cabo Verde','Cameroon','Central African Republic','Chad','Comoros','Congo','Democratic Republic of the Congo','Djibouti','Egypt','Equatorial Guinea','Eritrea','Eswatini','Ethiopia','Gabon','Gambia','Ghana','Guinea','Guinea-Bissau','Ivory Coast','Kenya','Lesotho','Liberia','Libya','Madagascar','Malawi','Mali','Mauritania','Mauritius','Morocco','Mozambique','Namibia','Niger','Nigeria','Rwanda','Sao Tome and Principe','Senegal','Seychelles','Sierra Leone','Somalia','South Africa','South Sudan','Sudan','Tanzania','Togo','Tunisia','Uganda','Western Sahara','Zambia','Zimbabwe'
  ],
  'Asia': [
    'Afghanistan','Armenia','Azerbaijan','Bahrain','Bangladesh','Bhutan','Brunei','Cambodia','China','Cyprus','East Timor','Georgia','India','Indonesia','Iran','Iraq','Israel','Japan','Jordan','Kazakhstan','Kuwait','Kyrgyzstan','Laos','Lebanon','Malaysia','Maldives','Mongolia','Myanmar','Nepal','North Korea','Oman','Pakistan','Palestine','Philippines','Qatar','Russia','Saudi Arabia','Singapore','South Korea','Sri Lanka','Syria','Taiwan','Tajikistan','Thailand','Turkey','Turkmenistan','United Arab Emirates','Uzbekistan','Vietnam','Yemen'
  ],
  'Europe': [
    'Albania','Andorra','Armenia','Austria','Azerbaijan','Belarus','Belgium','Bosnia and Herzegovina','Bulgaria','Croatia','Cyprus','Czechia','Denmark','Estonia','Finland','France','Georgia','Germany','Greece','Hungary','Iceland','Ireland','Italy','Kazakhstan','Kosovo','Latvia','Liechtenstein','Lithuania','Luxembourg','Malta','Moldova','Monaco','Montenegro','Netherlands','North Macedonia','Norway','Poland','Portugal','Romania','Russia','San Marino','Serbia','Slovakia','Slovenia','Spain','Sweden','Switzerland','Ukraine','United Kingdom','Vatican City'
  ],
  'North America': [
    'Antigua and Barbuda','Bahamas','Barbados','Belize','Canada','Costa Rica','Cuba','Dominica','Dominican Republic','El Salvador','Grenada','Guatemala','Haiti','Honduras','Jamaica','Mexico','Nicaragua','Panama','Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Trinidad and Tobago','United States'
  ],
  'South America': [
    'Argentina','Bolivia','Brazil','Chile','Colombia','Ecuador','Guyana','Paraguay','Peru','Suriname','Uruguay','Venezuela'
  ],
  'Oceania': [
    'Australia','Fiji','Kiribati','Marshall Islands','Micronesia','Nauru','New Zealand','Palau','Papua New Guinea','Samoa','Solomon Islands','Tonga','Tuvalu','Vanuatu'
  ],
  'Antarctica': [
    'Antarctica'
  ]
};

function fillContinentSelect() {
  const continentSelect = document.getElementById('continent-select');
  Object.keys(CONTINENT_COUNTRY_MAP).forEach(continent => {
    const opt = document.createElement('option');
    opt.value = continent;
    opt.textContent = continent;
    continentSelect.appendChild(opt);
  });
}

function fillCountrySelect(continent) {
  const countrySelect = document.getElementById('country-select');
  countrySelect.innerHTML = `<option value="">${LANG_MAP[currentLang].selectCountry}</option>`;
  if (!continent) {
    countrySelect.disabled = true;
    return;
  }
  CONTINENT_COUNTRY_MAP[continent].forEach(country => {
    const opt = document.createElement('option');
    opt.value = country;
    opt.textContent = country;
    countrySelect.appendChild(opt);
  });
  countrySelect.disabled = false;
}

function setupRegionSelector(globeRadioInstance) {
  fillContinentSelect();
  const regionToggle = document.getElementById('region-toggle');
  const regionDropdown = document.getElementById('region-dropdown');
  const continentSelect = document.getElementById('continent-select');
  const countrySelect = document.getElementById('country-select');

  regionToggle.onclick = () => {
    regionDropdown.classList.toggle('hidden');
  };
  document.body.addEventListener('click', (e) => {
    if (!regionDropdown.contains(e.target) && e.target !== regionToggle) {
      regionDropdown.classList.add('hidden');
    }
  });

  continentSelect.onchange = () => {
    fillCountrySelect(continentSelect.value);
    // Reset country selection
    countrySelect.value = '';
    // Only link country dropdown, don't show station list
    // globeRadioInstance.filterStationsByRegion(continentSelect.value, '');
  };
  countrySelect.onchange = () => {
    globeRadioInstance.filterStationsByRegion(continentSelect.value, countrySelect.value);
  };
}

// --- Page load initialization for region selector ---
window.addEventListener('DOMContentLoaded', () => {
  if (window.GlobeRadioInstance) {
    setupRegionSelector(window.GlobeRadioInstance);
  } else {
    // Wait for GlobeRadio initialization
    setTimeout(() => {
      if (window.GlobeRadioInstance) setupRegionSelector(window.GlobeRadioInstance);
    }, 1000);
  }
});

// --- In GlobeRadio constructor, register instance ---
const _oldGlobeRadio = GlobeRadio;
GlobeRadio = function(...args) {
  const inst = new _oldGlobeRadio(...args);
  window.GlobeRadioInstance = inst;
  return inst;
};

// --- Station list sidebar logic ---
function updateStationListSidebar(globeRadio, filtered, tab) {
  const sidebar = document.getElementById('station-list-sidebar');
  const list = document.getElementById('station-list');
  const closeBtn = document.getElementById('station-list-close');
  const backBtn = document.getElementById('station-list-back');
  const tabs = document.querySelectorAll('.station-tab');
  const searchInput = document.getElementById('station-list-search');
  // Close button
  closeBtn.onclick = () => { sidebar.classList.add('hidden'); };
  // Back button
  backBtn.onclick = () => {
    // Reset country selection, keep continent selection
    document.getElementById('country-select').value = '';
    // Only link country dropdown, don't show station list
    // document.getElementById('country-select').dispatchEvent(new Event('change'));
    // Tab switch back to all
    tabs.forEach(t => t.classList.remove('active'));
    tabs[0].classList.add('active');
    // Search box clear
    if (searchInput) searchInput.value = '';
    globeRadio.filterStationsByRegion('', '');
    updateStationListSidebar(globeRadio, null, 'all');
  };
  // Tab switch
  tabs.forEach(tabBtn => {
    tabBtn.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabBtn.classList.add('active');
      searchInput.value = '';
      if (tabBtn.dataset.tab === 'all') {
        updateStationListSidebar(globeRadio, null, 'all');
      } else if (tabBtn.dataset.tab === 'fav') {
        const favs = globeRadio.markerObjects.filter(m => globeRadio.favorites.has(m.userData.station.stream_url)).map(m => ({station: m.userData.station, marker: m}));
        updateStationListSidebar(globeRadio, favs, 'fav');
      } else if (tabBtn.dataset.tab === 'history') {
        const his = globeRadio.history.map(s => {
          const marker = globeRadio.markerObjects.find(m => m.userData.station.stream_url === s.stream_url);
          return marker ? {station: s, marker} : null;
        }).filter(Boolean);
        updateStationListSidebar(globeRadio, his, 'history');
      }
    };
  });
  // Search functionality
  if (!searchInput._listenerAdded) {
    searchInput.addEventListener('input', function() {
      const keyword = this.value.trim().toLowerCase();
      let stations = filtered;
      if (!filtered) {
        stations = globeRadio.markerObjects.map(marker => ({station: marker.userData.station, marker}));
      }
      if (keyword) {
        stations = stations.filter(({station}) => {
          return (
            (station.name && station.name.toLowerCase().includes(keyword)) ||
            (station.country && station.country.toLowerCase().includes(keyword)) ||
            (station.city && station.city.toLowerCase().includes(keyword))
          );
        });
      }
      renderStationList(stations, globeRadio, tab);
    });
    searchInput._listenerAdded = true;
  }
  // Fill list
  let stations = filtered;
  if (!filtered) {
    stations = globeRadio.markerObjects.map(marker => ({station: marker.userData.station, marker}));
  }
  renderStationList(stations, globeRadio, tab);
  sidebar.classList.remove('hidden');
}

function renderStationList(stations, globeRadio, tab) {
  const list = document.getElementById('station-list');
  list.innerHTML = '';
  if (stations.length === 0) {
    list.innerHTML = `<li style=\"color:#aaa;\">${LANG_MAP[currentLang].noStation}</li>`;
  } else {
    stations.forEach(({station, marker}, idx) => {
      const li = document.createElement('li');
      // Main information
      const mainDiv = document.createElement('div');
      mainDiv.className = 'station-main';
      mainDiv.innerHTML = `<b>${station.name}</b><span class="station-country">${station.country}${station.city ? ' - ' + station.city : ''}</span>`;
      li.appendChild(mainDiv);
      // Right operation area
      const opsDiv = document.createElement('div');
      opsDiv.className = 'station-ops';
      // Homepage link
      if (station.homepage) {
        const home = document.createElement('a');
        home.href = station.homepage;
        home.target = '_blank';
        home.textContent = LANG_MAP[currentLang].homepage;
        home.style.color = '#4FC3F7';
        home.style.fontSize = '14px';
        home.onclick = e => e.stopPropagation();
        opsDiv.appendChild(home);
      }
      // Favorite star
      const star = document.createElement('span');
      star.className = 'fav-star' + (globeRadio.favorites.has(station.stream_url) ? ' faved' : '');
      star.textContent = '★';
      star.title = globeRadio.favorites.has(station.stream_url) ? 'Remove favorite' : 'Add favorite';
      star.onclick = (e) => {
        e.stopPropagation();
        globeRadio.toggleFavorite(station);
        if (tab === 'fav') {
          const favs = globeRadio.markerObjects.filter(m => globeRadio.favorites.has(m.userData.station.stream_url)).map(m => ({station: m.userData.station, marker: m}));
          renderStationList(favs, globeRadio, tab);
        } else {
          renderStationList(stations, globeRadio, tab);
        }
      };
      opsDiv.appendChild(star);
      // Local time
      const timeSpan = document.createElement('span');
      timeSpan.className = 'station-localtime';
      (async () => {
        let localStr = '';
        const tz = await getTimezoneByCityCountry(station.city, station.country);
        if (tz) {
          const now = new Date();
          localStr = now.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', timeZone: tz});
        }
        timeSpan.textContent = localStr ? `🕒 ${localStr}` : '';
      })();
      timeSpan.style.color = '#FFD700';
      opsDiv.appendChild(timeSpan);
      li.appendChild(opsDiv);
      li.onclick = (e) => {
        if (e.target === star) return;
        globeRadio.markerObjects.forEach(m => m.material.color.setHex(m.userData.originalColor));
        marker.material.color.setHex(0xffff00);
        globeRadio.hoveredMarker = marker;
        globeRadio.playStation(station);
      };
      list.appendChild(li);
    });
  }
}

// --- Multi-language support ---
const LANG_MAP = {
  en: {
    all: 'All', fav: 'Favorites', history: 'History', list: 'Station List', back: 'Back', search: 'Search station/country/city...', selectContinent: 'Select Continent', selectCountry: 'Select Country', filter: 'Region Filter', noStation: 'No station', homepage: 'Homepage', play: 'Play', pause: 'Pause', loading: 'Loading...', timeout: 'Timeout', failed: 'Failed', select: 'Select a station', country: 'Country', city: 'City'
  },
  it: {
    all: 'Tutte', fav: 'Preferiti', history: 'Cronologia', list: 'Elenco Stazioni', back: 'Indietro', search: 'Cerca stazione/paese/città...', selectContinent: 'Seleziona Continente', selectCountry: 'Seleziona Paese', filter: 'Filtro Regione', noStation: 'Nessuna stazione', homepage: 'Homepage', play: 'Riproduci', pause: 'Pausa', loading: 'Caricamento...', timeout: 'Timeout', failed: 'Errore', select: 'Seleziona una stazione', country: 'Paese', city: 'Città'
  },
  zh: {
    all: '全部', fav: '收藏', history: '历史', list: '电台列表', back: '返回', search: '搜索电台/国家/城市...', selectContinent: '选择大洲', selectCountry: '选择国家', filter: '地区筛选', noStation: '无电台', homepage: '主页', play: '播放', pause: '暂停', loading: '加载中...', timeout: '加载超时', failed: '播放失败', select: '选择电台', country: '国家', city: '城市'
  }
};
let currentLang = localStorage.getItem('lang') || 'zh';

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('lang', lang);
  // Switch button highlight
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  // Tabs
  const tabs = document.querySelectorAll('.station-tab');
  tabs[0].textContent = LANG_MAP[lang].all;
  tabs[1].textContent = LANG_MAP[lang].fav;
  tabs[2].textContent = LANG_MAP[lang].history;
  // List header
  document.getElementById('station-list-title').textContent = LANG_MAP[lang].list;
  // Back button
  document.getElementById('station-list-back').textContent = lang === 'en' ? '←' : LANG_MAP[lang].back;
  // Search box
  document.getElementById('station-list-search').placeholder = LANG_MAP[lang].search;
  // Region filter button
  document.getElementById('region-toggle').innerHTML = `🌍 ${LANG_MAP[lang].filter}`;
  // Dropdown
  document.getElementById('continent-select').options[0].textContent = LANG_MAP[lang].selectContinent;
  document.getElementById('country-select').options[0].textContent = LANG_MAP[lang].selectCountry;
  
  // Player - Only show "Select a station" when no station is playing
  if (!window.GlobeRadioInstance?.currentStation) {
    document.getElementById('station-name').textContent = LANG_MAP[lang].select;
    document.getElementById('station-location').textContent = '';
    document.getElementById('player-status').textContent = '';
    // Reset play/pause icon to play
    if (typeof GlobeRadioInstance?.setPlayPauseIcon === 'function') {
      GlobeRadioInstance.setPlayPauseIcon(false);
    }
  } else {
    // If there is a station playing, update time display
    updatePlayerLocalTime(window.GlobeRadioInstance.currentStation);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.onclick = () => setLang(btn.dataset.lang);
  });
  setLang(currentLang);
});

// Initialize application
new GlobeRadio();

const cityTzCache = {};
const COUNTRY_MAIN_TZ = {
  'afghanistan': 'Asia/Kabul',
  'albania': 'Europe/Tirane',
  'algeria': 'Africa/Algiers',
  'andorra': 'Europe/Andorra',
  'angola': 'Africa/Luanda',
  'antigua and barbuda': 'America/Antigua',
  'argentina': 'America/Argentina/Buenos_Aires',
  'armenia': 'Asia/Yerevan',
  'australia': 'Australia/Sydney',
  'austria': 'Europe/Vienna',
  'azerbaijan': 'Asia/Baku',
  'bahamas': 'America/Nassau',
  'bahrain': 'Asia/Bahrain',
  'bangladesh': 'Asia/Dhaka',
  'barbados': 'America/Barbados',
  'belarus': 'Europe/Minsk',
  'belgium': 'Europe/Brussels',
  'belize': 'America/Belize',
  'benin': 'Africa/Porto-Novo',
  'bhutan': 'Asia/Thimphu',
  'bolivia': 'America/La_Paz',
  'bosnia and herzegovina': 'Europe/Sarajevo',
  'botswana': 'Africa/Gaborone',
  'brazil': 'America/Sao_Paulo',
  'brunei': 'Asia/Brunei',
  'bulgaria': 'Europe/Sofia',
  'burkina faso': 'Africa/Ouagadougou',
  'burundi': 'Africa/Bujumbura',
  'cabo verde': 'Atlantic/Cape_Verde',
  'cambodia': 'Asia/Phnom_Penh',
  'cameroon': 'Africa/Douala',
  'canada': 'America/Toronto',
  'central african republic': 'Africa/Bangui',
  'chad': 'Africa/Ndjamena',
  'chile': 'America/Santiago',
  'china': 'Asia/Shanghai',
  'colombia': 'America/Bogota',
  'comoros': 'Indian/Comoro',
  'congo': 'Africa/Brazzaville',
  'congo (democratic republic)': 'Africa/Kinshasa',
  'costa rica': 'America/Costa_Rica',
  'croatia': 'Europe/Zagreb',
  'cuba': 'America/Havana',
  'cyprus': 'Asia/Nicosia',
  'czechia': 'Europe/Prague',
  'denmark': 'Europe/Copenhagen',
  'djibouti': 'Africa/Djibouti',
  'dominica': 'America/Dominica',
  'dominican republic': 'America/Santo_Domingo',
  'ecuador': 'America/Guayaquil',
  'egypt': 'Africa/Cairo',
  'el salvador': 'America/El_Salvador',
  'equatorial guinea': 'Africa/Malabo',
  'eritrea': 'Africa/Asmara',
  'estonia': 'Europe/Tallinn',
  'eswatini': 'Africa/Mbabane',
  'ethiopia': 'Africa/Addis_Ababa',
  'fiji': 'Pacific/Fiji',
  'finland': 'Europe/Helsinki',
  'france': 'Europe/Paris',
  'gabon': 'Africa/Libreville',
  'gambia': 'Africa/Banjul',
  'georgia': 'Asia/Tbilisi',
  'germany': 'Europe/Berlin',
  'ghana': 'Africa/Accra',
  'greece': 'Europe/Athens',
  'grenada': 'America/Grenada',
  'guatemala': 'America/Guatemala',
  'guinea': 'Africa/Conakry',
  'guinea-bissau': 'Africa/Bissau',
  'guyana': 'America/Guyana',
  'haiti': 'America/Port-au-Prince',
  'honduras': 'America/Tegucigalpa',
  'hungary': 'Europe/Budapest',
  'iceland': 'Atlantic/Reykjavik',
  'india': 'Asia/Kolkata',
  'indonesia': 'Asia/Jakarta',
  'iran': 'Asia/Tehran',
  'iraq': 'Asia/Baghdad',
  'ireland': 'Europe/Dublin',
  'israel': 'Asia/Jerusalem',
  'italy': 'Europe/Rome',
  'jamaica': 'America/Jamaica',
  'japan': 'Asia/Tokyo',
  'jordan': 'Asia/Amman',
  'kazakhstan': 'Asia/Almaty',
  'kenya': 'Africa/Nairobi',
  'kiribati': 'Pacific/Tarawa',
  'kuwait': 'Asia/Kuwait',
  'kyrgyzstan': 'Asia/Bishkek',
  'laos': 'Asia/Vientiane',
  'latvia': 'Europe/Riga',
  'lebanon': 'Asia/Beirut',
  'lesotho': 'Africa/Maseru',
  'liberia': 'Africa/Monrovia',
  'libya': 'Africa/Tripoli',
  'liechtenstein': 'Europe/Vaduz',
  'lithuania': 'Europe/Vilnius',
  'luxembourg': 'Europe/Luxembourg',
  'madagascar': 'Indian/Antananarivo',
  'malawi': 'Africa/Blantyre',
  'malaysia': 'Asia/Kuala_Lumpur',
  'maldives': 'Indian/Maldives',
  'mali': 'Africa/Bamako',
  'malta': 'Europe/Malta',
  'marshall islands': 'Pacific/Majuro',
  'mauritania': 'Africa/Nouakchott',
  'mauritius': 'Indian/Mauritius',
  'mexico': 'America/Mexico_City',
  'micronesia': 'Pacific/Pohnpei',
  'moldova': 'Europe/Chisinau',
  'monaco': 'Europe/Monaco',
  'mongolia': 'Asia/Ulaanbaatar',
  'montenegro': 'Europe/Podgorica',
  'morocco': 'Africa/Casablanca',
  'mozambique': 'Africa/Maputo',
  'myanmar': 'Asia/Yangon',
  'namibia': 'Africa/Windhoek',
  'nauru': 'Pacific/Nauru',
  'nepal': 'Asia/Kathmandu',
  'netherlands': 'Europe/Amsterdam',
  'new zealand': 'Pacific/Auckland',
  'nicaragua': 'America/Managua',
  'niger': 'Africa/Niamey',
  'nigeria': 'Africa/Lagos',
  'north korea': 'Asia/Pyongyang',
  'north macedonia': 'Europe/Skopje',
  'norway': 'Europe/Oslo',
  'oman': 'Asia/Muscat',
  'pakistan': 'Asia/Karachi',
  'palau': 'Pacific/Palau',
  'palestine': 'Asia/Gaza',
  'panama': 'America/Panama',
  'papua new guinea': 'Pacific/Port_Moresby',
  'paraguay': 'America/Asuncion',
  'peru': 'America/Lima',
  'philippines': 'Asia/Manila',
  'poland': 'Europe/Warsaw',
  'portugal': 'Europe/Lisbon',
  'qatar': 'Asia/Qatar',
  'romania': 'Europe/Bucharest',
  'russia': 'Europe/Moscow',
  'rwanda': 'Africa/Kigali',
  'saint kitts and nevis': 'America/St_Kitts',
  'saint lucia': 'America/St_Lucia',
  'saint vincent and the grenadines': 'America/St_Vincent',
  'samoa': 'Pacific/Apia',
  'san marino': 'Europe/San_Marino',
  'sao tome and principe': 'Africa/Sao_Tome',
  'saudi arabia': 'Asia/Riyadh',
  'senegal': 'Africa/Dakar',
  'serbia': 'Europe/Belgrade',
  'seychelles': 'Indian/Mahe',
  'sierra leone': 'Africa/Freetown',
  'singapore': 'Asia/Singapore',
  'slovakia': 'Europe/Bratislava',
  'slovenia': 'Europe/Ljubljana',
  'solomon islands': 'Pacific/Guadalcanal',
  'somalia': 'Africa/Mogadishu',
  'south africa': 'Africa/Johannesburg',
  'south korea': 'Asia/Seoul',
  'south sudan': 'Africa/Juba',
  'spain': 'Europe/Madrid',
  'sri lanka': 'Asia/Colombo',
  'sudan': 'Africa/Khartoum',
  'suriname': 'America/Paramaribo',
  'sweden': 'Europe/Stockholm',
  'switzerland': 'Europe/Zurich',
  'syria': 'Asia/Damascus',
  'taiwan': 'Asia/Taipei',
  'tajikistan': 'Asia/Dushanbe',
  'tanzania': 'Africa/Dar_es_Salaam',
  'thailand': 'Asia/Bangkok',
  'timor-leste': 'Asia/Dili',
  'togo': 'Africa/Lome',
  'tonga': 'Pacific/Tongatapu',
  'trinidad and tobago': 'America/Port_of_Spain',
  'tunisia': 'Africa/Tunis',
  'turkey': 'Europe/Istanbul',
  'turkmenistan': 'Asia/Ashgabat',
  'tuvalu': 'Pacific/Funafuti',
  'uganda': 'Africa/Kampala',
  'ukraine': 'Europe/Kyiv',
  'united arab emirates': 'Asia/Dubai',
  'united kingdom': 'Europe/London',
  'united states': 'America/New_York',
  'uruguay': 'America/Montevideo',
  'uzbekistan': 'Asia/Tashkent',
  'vanuatu': 'Pacific/Efate',
  'vatican city': 'Europe/Vatican',
  'venezuela': 'America/Caracas',
  'vietnam': 'Asia/Ho_Chi_Minh',
  'yemen': 'Asia/Aden',
  'zambia': 'Africa/Lusaka',
  'zimbabwe': 'Africa/Harare',
};
async function getTimezoneByCityCountry(city, country) {
    const key = `${city || ''}|${country || ''}`.toLowerCase();
    if (cityTzCache[key]) return cityTzCache[key];
    try {
        const resp = await fetch('https://worldtimeapi.org/api/timezone');
        const zones = await resp.json();
        const cityNorm = city ? city.toLowerCase().replace(/\s+/g, '').replace(/[^a-z]/g, '') : '';
        const countryNorm = country ? country.toLowerCase().replace(/\s+/g, '').replace(/[^a-z]/g, '') : '';
        // 1. Try various city name variations
        let zone = null;
        if (cityNorm) {
            zone = zones.find(z => z.toLowerCase().replace(/[_\s-]/g, '').includes(cityNorm));
            if (!zone) zone = zones.find(z => z.toLowerCase().includes(cityNorm));
        }
        // 2. If no city match, use country name
        if (!zone && countryNorm) {
            zone = zones.find(z => z.toLowerCase().replace(/[_\s-]/g, '').includes(countryNorm));
            if (!zone) zone = zones.find(z => z.toLowerCase().includes(countryNorm));
        }
        // 3. Fallback: Use country main timezone
        if (!zone && countryNorm && COUNTRY_MAIN_TZ[countryNorm]) {
            zone = COUNTRY_MAIN_TZ[countryNorm];
        }
        if (zone) cityTzCache[key] = zone;
        return zone || null;
    } catch (e) { 
        // Fallback: Use country main timezone
        const countryNorm = country ? country.toLowerCase().replace(/\s+/g, '').replace(/[^a-z]/g, '') : '';
        if (countryNorm && COUNTRY_MAIN_TZ[countryNorm]) {
            return COUNTRY_MAIN_TZ[countryNorm];
        }
        return null; 
    }
}
async function updatePlayerLocalTime(station) {
    const timeElem = document.getElementById('station-localtime');
    if (!station) { 
        timeElem.textContent = currentLang === 'zh' ? '🕒 Unknown' : 
                              currentLang === 'en' ? '🕒 Unknown' : 
                              '🕒 Sconosciuto'; 
        return; 
    }
    const tz = await getTimezoneByCityCountry(station.city, station.country);
    if (tz) {
        const now = new Date();
        const localStr = now.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', timeZone: tz});
        timeElem.textContent = `🕒 ${localStr}`;
    } else {
        timeElem.textContent = currentLang === 'zh' ? '🕒 Unknown' : 
                              currentLang === 'en' ? '🕒 Unknown' : 
                              '🕒 Sconosciuto';
    }
} 
