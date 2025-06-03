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
        // 创建场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);

        // 创建相机
        this.camera = new THREE.PerspectiveCamera(
            45,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.z = 6;

        // 创建渲染器
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000);
        const globeContainer = document.getElementById('globe-container');
        console.log('globe-container:', globeContainer);
        this.renderer.domElement && console.log('renderer dom:', this.renderer.domElement);
        globeContainer && globeContainer.appendChild(this.renderer.domElement);

        // 创建地球
        const geometry = new THREE.SphereGeometry(2, 64, 64);
        const textureLoader = new THREE.TextureLoader();
        const earthTexture = textureLoader.load('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg');
        const material = new THREE.MeshPhongMaterial({
            map: earthTexture,
            shininess: 5
        });
        this.globe = new THREE.Mesh(geometry, material);
        this.scene.add(this.globe);

        // 恢复原先的光照
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(5, 3, 5);
        this.scene.add(directionalLight);

        // 添加控制器
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.rotateSpeed = 0.5;

        // 创建射线投射器用于点击检测
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // 创建加载提示
        this.createLoadingIndicator();

        // 创建信息弹窗
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
        loadingDiv.textContent = '正在加载电台数据...';
        document.body.appendChild(loadingDiv);
    }

    async loadZenoStations() {
        try {
            // 加载本地 stations.json
            const response = await fetch('stations.json');
            const stationsData = await response.json();

            stationsData.forEach(station => {
                const key = `${station.latitude},${station.longitude}`;
                if (!this.stations.has(key)) {
                    this.stations.set(key, []);
                }
                this.stations.get(key).push(station);
            });

            // 在地球上添加电台标记
            this.addStationMarkers();

            // 移除加载提示
            const loadingIndicator = document.getElementById('loading-indicator');
            if (loadingIndicator) {
                loadingIndicator.remove();
            }

            // 创建电台列表
            this.createStationList();
        } catch (error) {
            console.error('Error loading stations:', error);
            const loadingIndicator = document.getElementById('loading-indicator');
            if (loadingIndicator) {
                loadingIndicator.textContent = '加载电台数据失败';
                loadingIndicator.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
            }
        }
    }

    addStationMarkers() {
        const markerGeometry = new THREE.SphereGeometry(0.008, 8, 8); // marker贴地球表面
        const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const markerRadius = this.globeScale; // marker贴地球表面
        const markerTipRadius = this.globeScale * 1.025; // 光柱终点
        const beamRadius = 0.002; // 光柱很细
        const beamMaterial = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.7 });

        this.markerObjects = [];
        this.beamObjects = [];

        this.stations.forEach((stations, coords) => {
            stations.forEach(station => {
                const [lat, lon] = [station.latitude, station.longitude];
                const phi = (90 - lat) * (Math.PI / 180);
                const theta = (lon + 180) * (Math.PI / 180);

                // marker贴地球表面
                const marker = new THREE.Mesh(markerGeometry, markerMaterial.clone());
                marker.position.x = -markerRadius * Math.sin(phi) * Math.cos(theta);
                marker.position.y = markerRadius * Math.cos(phi);
                marker.position.z = markerRadius * Math.sin(phi) * Math.sin(theta);
                marker.userData.station = station;
                marker.userData.originalColor = 0xff0000;
                this.scene.add(marker);
                this.markerObjects.push(marker);

                // 光柱
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
                // CylinderGeometry默认y轴为高度方向
                const beamGeometry = new THREE.CylinderGeometry(beamRadius, beamRadius, beamHeight, 8);
                const beam = new THREE.Mesh(beamGeometry, beamMaterial.clone());
                // 设置光柱中心点在start和end中点
                beam.position.copy(start).add(end).multiplyScalar(0.5);
                // 旋转光柱指向end-start
                beam.lookAt(end);
                beam.rotateX(Math.PI / 2); // 使光柱沿着start->end方向
                beam.userData.marker = marker; // 让光柱知道对应的marker
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
        // 遍历所有marker，找距离鼠标最近的
        this.markerObjects.forEach(marker => {
            // 3D坐标投影到屏幕
            const pos = marker.position.clone().project(this.camera);
            const screenX = (pos.x + 1) / 2 * rect.width;
            const screenY = (-pos.y + 1) / 2 * rect.height;
            const dist = Math.sqrt((screenX - mouseX) ** 2 + (screenY - mouseY) ** 2);
            if (dist < minDist) {
                minDist = dist;
                closestMarker = marker;
            }
        });
        // 阈值（像素）
        const threshold = 10;
        // 先全部还原
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

        // 检查所有marker的交互
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
        console.log('setupEventListeners running');
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        const playPauseBtn = document.getElementById('play-pause');
        if (playPauseBtn) {
          playPauseBtn.addEventListener('click', () => {
              this.togglePlay();
          });
          console.log('play-pause listener added');
        }

        const volumeInput = document.getElementById('volume');
        if (volumeInput) {
          volumeInput.addEventListener('input', (e) => {
              this.audio.volume = e.target.value / 100;
          });
           console.log('volume listener added');
        }

        // 收藏按钮
        const favBtn = document.getElementById('fav-btn');
        if (favBtn) {
          favBtn.addEventListener('click', () => {
              if (!this.currentStation) return;
              this.toggleFavorite(this.currentStation);
              this.updateFavBtn(this.currentStation);
          });
          console.log('fav-btn listener added');
        }

        // 上一台按钮
        const prevStationBtn = document.getElementById('prev-station');
        console.log('Looking for #prev-station:', prevStationBtn);
        if (prevStationBtn) {
            console.log('#prev-station found, adding listener...');
            prevStationBtn.addEventListener('click', () => {
                this.playRandomStation(); // Call random play
            });
            console.log('#prev-station listener added');
        }

        // 下一台按钮
        const nextStationBtn = document.getElementById('next-station');
        console.log('Looking for #next-station:', nextStationBtn);
        if (nextStationBtn) {
            console.log('#next-station found, adding listener...');
            nextStationBtn.addEventListener('click', () => {
                this.playRandomStation(); // Call random play
            });
            console.log('#next-station listener added');
        }
         console.log('setupEventListeners finished');
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
        // 如果当前Tab是收藏，刷新收藏列表
        const activeTab = document.querySelector('.station-tab.active');
        if (activeTab && activeTab.dataset.tab === 'fav') {
            const favs = this.markerObjects.filter(m => this.favorites.has(m.userData.station.stream_url)).map(m => ({station: m.userData.station, marker: m}));
            updateStationListSidebar(this, favs, 'fav');
        }
    }

    playStation(station) {
        this.currentStation = station;
        console.log('playStation', station);
        // 立即显示播放器界面
        document.getElementById('station-name').textContent = station.name;
        document.getElementById('station-location').textContent = `${station.country} - ${station.city}`;
        document.getElementById('radio-player').classList.remove('hidden');
        // 状态提示
        document.getElementById('player-status').textContent = LANG_MAP[this.currentLanguage].loading;
        // 切换播放/暂停图标
        this.setPlayPauseIcon(false);
        // 停止当前播放
        if (this.audio) {
            this.audio.pause();
            this.audio.src = '';
        }
        // 只更换src，不new Audio
        this.audio.src = station.stream_url;
        // 添加到历史记录
        this.addToHistory(station);
        // 设置加载超时
        const loadTimeout = setTimeout(() => {
            if (!this.isPlaying) {
                document.getElementById('player-status').textContent = LANG_MAP[this.currentLanguage].timeout;
                this.setPlayPauseIcon(false);
            }
        }, 5000);  // 5秒超时
        // 尝试播放
        this.audio.play()
            .then(() => {
                clearTimeout(loadTimeout);
                console.log('Playback started successfully');
                this.isPlaying = true;
                document.getElementById('player-status').textContent = '';
                this.setPlayPauseIcon(true);
                // 更新收藏按钮状态
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
        // 平滑缩放动画
        if (this.isZooming) {
            const scaleDiff = this.targetScale - this.globeScale;
            if (Math.abs(scaleDiff) > 0.01) {
                this.globeScale += scaleDiff * 0.1; // 缓动
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
            // 更新光柱
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
        // 1. 先隐藏所有marker和beam
        if (this.markerObjects) this.markerObjects.forEach(m => m.visible = false);
        if (this.beamObjects) this.beamObjects.forEach(b => b.beam.visible = false);
        // 2. 如果未选大洲，全部显示
        if (!continent) {
            if (this.markerObjects) this.markerObjects.forEach(m => m.visible = true);
            if (this.beamObjects) this.beamObjects.forEach(b => b.beam.visible = true);
            updateStationListSidebar(this, null); // 显示全部电台
            return;
        }
        // 3. 获取该大洲下所有国家
        const countries = CONTINENT_COUNTRY_MAP[continent] || [];
        // 4. 遍历所有marker，判断是否属于该国家
        const filteredStations = [];
        this.markerObjects.forEach((marker, i) => {
            const station = marker.userData.station;
            if (!station) return;
            // 宽松匹配：忽略大小写和空格
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
            timeElement.textContent = this.currentLanguage === 'zh' ? '未知' : 
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
            timeElement.textContent = this.currentLanguage === 'zh' ? '未知' : 
                                    this.currentLanguage === 'en' ? 'Unknown' : 
                                    'Sconosciuto';
        }
    }

    // 角度转弧度
    toRad(degrees) {
        return degrees * (Math.PI/180);
    }

    // 随机播放一个电台
    playRandomStation() {
        if (!this.markerObjects || this.markerObjects.length === 0) {
            console.warn('No stations available for random playback.');
            return;
        }

        // 获取所有可用的电台，排除当前正在播放的
        const availableStations = this.markerObjects
            .map(marker => marker.userData.station)
            .filter(station => station.stream_url !== this.currentStation?.stream_url);

        if (availableStations.length === 0) {
             console.warn('No other stations available for random playback.');
             return;
        }

        // 随机选择一个电台
        const randomIndex = Math.floor(Math.random() * availableStations.length);
        const randomStation = availableStations[randomIndex];
        console.log('Playing random station:', randomStation);
        this.playStation(randomStation);
    }

    // --- createStationList method ---
    createStationList() {
      const globeRadioInstance = this;
      const sidebar = document.getElementById('station-list-sidebar');
      const closeBtn = document.getElementById('station-list-close');
      const backBtn = document.getElementById('station-list-back');
      const tabs = document.querySelectorAll('.station-tab');
      const searchInput = document.getElementById('station-list-search');
      const list = document.getElementById('station-list');

      // Ensure elements exist before adding listeners
      if(closeBtn) closeBtn.onclick = () => { sidebar.classList.add('hidden'); };
      if(backBtn) {
        backBtn.onclick = () => {
          // 只重置国家选择，保留大洲选择
          const countrySelect = document.getElementById('country-select');
          if(countrySelect) countrySelect.value = '';
          // Tab切换回全部
          tabs.forEach(t => t.classList.remove('active'));
          if(tabs[0]) tabs[0].classList.add('active');
          // 搜索框清空
          if (searchInput) searchInput.value = '';
          globeRadioInstance.filterStationsByRegion('', '');
          updateStationListSidebar(globeRadioInstance, null, 'all');
        };
      }

      // Tab切换
      tabs.forEach(tabBtn => {
        tabBtn.onclick = () => {
          tabs.forEach(t => t.classList.remove('active'));
          tabBtn.classList.add('active');
          if (searchInput) searchInput.value = '';
          if (tabBtn.dataset.tab === 'all') {
            updateStationListSidebar(globeRadioInstance, null, 'all');
          } else if (tabBtn.dataset.tab === 'fav') {
            const favs = globeRadioInstance.markerObjects.filter(m => globeRadioInstance.favorites.has(m.userData.station.stream_url)).map(m => ({station: m.userData.station, marker: m}));
            updateStationListSidebar(globeRadioInstance, favs, 'fav');
          } else if (tabBtn.dataset.tab === 'history') {
            const his = globeRadioInstance.history.map(s => {
              const marker = globeRadioInstance.markerObjects.find(m => m.userData.station.stream_url === s.stream_url);
              return marker ? {station: s, marker} : null;
            }).filter(Boolean);
            updateStationListSidebar(globeRadioInstance, his, 'history');
          }
        };
      });

      // 搜索功能
      if (searchInput && !searchInput._listenerAdded) {
        searchInput.addEventListener('input', function() {
          const keyword = this.value.trim().toLowerCase();
          let stations = null; // Start with all stations
          // Use filtered stations if a filter is active, otherwise all stations
          const activeTab = document.querySelector('.station-tab.active');
          if (activeTab && activeTab.dataset.tab !== 'all') {
              // If not in 'all' tab, search within the currently displayed list
              // This part might need adjustment based on how filtering is stored
              // For simplicity, let's assume search always applies to ALL stations then filter
               stations = globeRadioInstance.markerObjects.map(marker => ({station: marker.userData.station, marker}));
          } else {
               stations = globeRadioInstance.markerObjects.map(marker => ({station: marker.userData.station, marker}));
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
          // Re-filter by region if a region filter is active AFTER search
           const continentSelect = document.getElementById('continent-select');
           const countrySelect = document.getElementById('country-select');
           const currentContinent = continentSelect ? continentSelect.value : '';
           const currentCountry = countrySelect ? countrySelect.value : '';

           if (currentContinent || currentCountry) {
                stations = stations.filter(({station}) => {
                    const stationCountry = (station.country || '').toLowerCase().replace(/\s+/g, '');
                    if (currentCountry) {
                         return stationCountry === currentCountry.toLowerCase().replace(/\s+/g, '');
                    } else if (currentContinent) {
                         const countries = CONTINENT_COUNTRY_MAP[currentContinent] || [];
                         return countries.some(c => stationCountry === c.toLowerCase().replace(/\s+/g, ''));
                    }
                    return true; // Should not reach here if filter is active
                });
           }

          renderStationList(stations, globeRadioInstance, activeTab ? activeTab.dataset.tab : 'all');
        });
        searchInput._listenerAdded = true;
      }

      // Initially render the full list
       const allStations = globeRadioInstance.markerObjects.map(marker => ({station: marker.userData.station, marker}));
      renderStationList(allStations, globeRadioInstance, 'all');
      if(sidebar) sidebar.classList.remove('hidden');
    }
    // --- End of createStationList method ---
}

// --- 地区筛选逻辑 ---
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
    // 重置国家选择
    countrySelect.value = '';
    // 只联动国家下拉，不弹出电台列表
    // globeRadioInstance.filterStationsByRegion(continentSelect.value, '');
  };
  countrySelect.onchange = () => {
    globeRadioInstance.filterStationsByRegion(continentSelect.value, countrySelect.value);
  };
}

// --- 页面加载后初始化地区选择器 ---
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.onclick = () => setLang(btn.dataset.lang);
  });
  // Initialize region selector AFTER GlobeRadioInstance is created and available
  // setLang will be called from within the modified GlobeRadio constructor
  // setupRegionSelector will be called once GlobeRadioInstance is set
  const originalGlobeRadio = window.GlobeRadio;
  window.GlobeRadio = function(...args) {
    const inst = new originalGlobeRadio(...args);
    window.GlobeRadioInstance = inst;
    // Call setLang and setupRegionSelector here once the instance is ready
    setLang(currentLang); // This call needs GlobeRadioInstance
    setupRegionSelector(inst);
    return inst;
  };

  // Initialize application (this will now use the modified GlobeRadio constructor)
  new GlobeRadio();
});

// --- 电台列表侧边栏逻辑 ---
function updateStationListSidebar(globeRadio, filtered, tab) {
  const sidebar = document.getElementById('station-list-sidebar');
  const list = document.getElementById('station-list');
  const closeBtn = document.getElementById('station-list-close');
  const backBtn = document.getElementById('station-list-back');
  const tabs = document.querySelectorAll('.station-tab');
  const searchInput = document.getElementById('station-list-search');
  // 关闭按钮
  closeBtn.onclick = () => { sidebar.classList.add('hidden'); };
  // 返回按钮
  backBtn.onclick = () => {
    // 只重置国家选择，保留大洲选择
    document.getElementById('country-select').value = '';
    // 只联动国家下拉，不弹出电台列表
    // document.getElementById('country-select').dispatchEvent(new Event('change'));
    // Tab切换回全部
    tabs.forEach(t => t.classList.remove('active'));
    tabs[0].classList.add('active');
    // 搜索框清空
    if (searchInput) searchInput.value = '';
    globeRadio.filterStationsByRegion('', '');
    updateStationListSidebar(globeRadio, null, 'all');
  };
  // Tab切换
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
  // 搜索功能
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
  // 填充列表
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
      // 主体信息
      const mainDiv = document.createElement('div');
      mainDiv.className = 'station-main';
      mainDiv.innerHTML = `<b>${station.name}</b><span class="station-country">${station.country}${station.city ? ' - ' + station.city : ''}</span>`;
      li.appendChild(mainDiv);
      // 右侧操作区
      const opsDiv = document.createElement('div');
      opsDiv.className = 'station-ops';
      // 主页链接
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
      // 收藏星标
      const star = document.createElement('span');
      star.className = 'fav-star' + (globeRadio.favorites.has(station.stream_url) ? ' faved' : '');
      star.textContent = '★';
      star.title = globeRadio.favorites.has(station.stream_url) ? '取消收藏' : '收藏';
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
      // 当地时间
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

// --- 多语言支持 ---
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
    // 切换按钮高亮
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });
    // Tabs
    const tabs = document.querySelectorAll('.station-tab');
    tabs[0].textContent = LANG_MAP[lang].all;
    tabs[1].textContent = LANG_MAP[lang].fav;
    tabs[2].textContent = LANG_MAP[lang].history;
    // 列表header
    document.getElementById('station-list-title').textContent = LANG_MAP[lang].list;
    // 返回按钮
    document.getElementById('station-list-back').textContent = lang === 'en' ? '←' : LANG_MAP[lang].back;
    // 搜索框
    document.getElementById('station-list-search').placeholder = LANG_MAP[lang].search;
    // 地区筛选按钮
    document.getElementById('region-toggle').innerHTML = `🌍 ${LANG_MAP[lang].filter}`;
    // 下拉
    document.getElementById('continent-select').options[0].textContent = LANG_MAP[lang].selectContinent;
    document.getElementById('country-select').options[0].textContent = LANG_MAP[lang].selectCountry;

    // 播放器 - 只在没有播放电台时显示"选择电台"
    if (!window.GlobeRadioInstance?.currentStation) {
        document.getElementById('station-name').textContent = LANG_MAP[lang].select;
        document.getElementById('station-location').textContent = '';
        document.getElementById('player-status').textContent = '';
        // 重置播放/暂停图标为播放
        if (typeof window.GlobeRadioInstance?.setPlayPauseIcon === 'function') {
            window.GlobeRadioInstance.setPlayPauseIcon(false);
        }
    } else if (window.GlobeRadioInstance?.currentStation) {
        // 如果有正在播放的电台且 GlobeRadioInstance 已定义，更新时间的显示
        updatePlayerLocalTime(window.GlobeRadioInstance.currentStation);
    }
}

async function updatePlayerLocalTime(station) {
    const timeElem = document.getElementById('station-localtime');
    if (!timeElem) return;
    if (!station) { 
        timeElem.textContent = currentLang === 'zh' ? '🕒 未知' : 
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
        timeElem.textContent = currentLang === 'zh' ? '🕒 未知' : 
                              currentLang === 'en' ? '🕒 Unknown' : 
                              '🕒 Sconosciuto';
    }
}

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
        // 1. 尝试各种城市名变体
        let zone = null;
        if (cityNorm) {
            zone = zones.find(z => z.toLowerCase().replace(/[_\s-]/g, '').includes(cityNorm));
            if (!zone) zone = zones.find(z => z.toLowerCase().includes(cityNorm));
        }
        // 2. 匹配不到城市时，用国家名
        if (!zone && countryNorm) {
            zone = zones.find(z => z.toLowerCase().replace(/[_\s-]/g, '').includes(countryNorm));
            if (!zone) zone = zones.find(z => z.toLowerCase().includes(countryNorm));
        }
        // 3. 兜底：用国家主时区
        if (!zone && countryNorm && COUNTRY_MAIN_TZ[countryNorm]) {
            zone = COUNTRY_MAIN_TZ[countryNorm];
        }
        if (zone) cityTzCache[key] = zone;
        return zone || null;
    } catch (e) { 
        // 兜底：用国家主时区
        const countryNorm = country ? country.toLowerCase().replace(/\s+/g, '').replace(/[^a-z]/g, '') : '';
        if (countryNorm && COUNTRY_MAIN_TZ[countryNorm]) {
            return COUNTRY_MAIN_TZ[countryNorm];
        }
        return null; 
    }
} 