/** Own property-panel interaction and presentation. */
export class PropertiesControls {
  constructor({ elements, properties, actions }) {
    Object.assign(this, elements);
    this.properties = properties;
    this.actions = actions;
    this.destroyed = false;
    this.listeners = new AbortController();
    this._propertiesUnsubscribe = null;
    this._propertiesState = null;
    this._photoIndex = 0;
    this._initPanel();
  }

  listen(target, type, handler, options = {}) {
    target?.addEventListener(type, handler, {
      ...options,
      signal: this.listeners.signal,
    });
  }

  getState() {
    return this._propertiesState;
  }

  connect() {
    this._propertiesUnsubscribe?.();
    this._propertiesUnsubscribe = null;
    if (this.destroyed) return;
    this._propertiesUnsubscribe = this.properties?.subscribe?.((state) =>
      this._renderState(state),
    );
    if (this.properties?.getUIState)
      this._renderState(this.properties.getUIState());
  }

  _initPanel() {
    this.listen(this._propertiesEnableBtn, 'click', async () => {
      if (!this.actions?.setEnabled) return;
      const enabled = this.actions.isEnabled?.();
      await this.actions.setEnabled(!enabled);
    });

    this.listen(this._propertiesFlyBtn, 'click', () => {
      const state = this.properties?.getUIState?.();
      const id = state?.activePropertyId;
      if (id) this.properties?.flyToProperty(id);
    });

    this.listen(this._propertiesPhotoPrev, 'click', () => {
      this._cyclePhoto(-1);
    });

    this.listen(this._propertiesPhotoNext, 'click', () => {
      this._cyclePhoto(1);
    });
  }

  _cyclePhoto(delta) {
    const photos = this._propertiesState?.activeProperty?.photos || [];
    if (photos.length <= 1) return;
    this._photoIndex =
      (this._photoIndex + delta + photos.length) % photos.length;
    if (this._propertiesPhoto) {
      this._propertiesPhoto.src = photos[this._photoIndex];
    }
    if (this._propertiesPhotoCounter) {
      this._propertiesPhotoCounter.textContent = `${this._photoIndex + 1} / ${photos.length}`;
    }
  }

  _formatPrice(price, priceType) {
    if (price == null) return 'Preço sob consulta';
    const formatted = new Intl.NumberFormat('pt-PT', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(price);
    return priceType === 'rent' ? `${formatted}/mês` : formatted;
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  _renderState(state) {
    this._propertiesState = state;
    const enabled = !!state?.enabled && !!this.actions?.isEnabled?.();
    const count = state?.count || 0;
    const error = state?.error;
    const active = state?.activeProperty;

    if (this._propertiesEnableBtn) {
      this._propertiesEnableBtn.textContent = enabled
        ? 'PROPERTIES ON'
        : 'PROPERTIES OFF';
      this._propertiesEnableBtn.classList.toggle('active', enabled);
    }

    if (this._propertiesStatus) {
      if (error) {
        this._propertiesStatus.textContent = error;
      } else if (enabled && count > 0) {
        this._propertiesStatus.textContent = `${count} listings loaded`;
      } else if (enabled) {
        this._propertiesStatus.textContent = 'Loading listings…';
      } else {
        this._propertiesStatus.textContent =
          'Enable Properties to load Portuguese listings';
      }
    }

    if (active) {
      const photos = active.photos || [];
      this._photoIndex = 0;
      if (this._propertiesPhoto && photos.length > 0) {
        this._propertiesPhoto.src = photos[0];
      } else if (this._propertiesPhoto) {
        this._propertiesPhoto.removeAttribute('src');
      }
      if (this._propertiesPhotoCounter) {
        this._propertiesPhotoCounter.textContent =
          photos.length > 1 ? `1 / ${photos.length}` : '';
      }
      if (this._propertiesPhotoPrev)
        this._propertiesPhotoPrev.style.display =
          photos.length > 1 ? '' : 'none';
      if (this._propertiesPhotoNext)
        this._propertiesPhotoNext.style.display =
          photos.length > 1 ? '' : 'none';

      if (this._propertiesMeta) {
        const features = [];
        if (active.hasElevator) features.push('Elevador');
        if (active.hasParking) features.push('Estacionamento');
        if (active.hasGarden) features.push('Jardim');
        if (active.energyCert) features.push(`CE: ${active.energyCert}`);

        const details = [];
        if (active.typology) details.push(`<span>${active.typology}</span>`);
        if (active.areaNet != null)
          details.push(`<span>${active.areaNet} m²</span>`);
        if (active.bedrooms != null)
          details.push(`<span>${active.bedrooms} quartos</span>`);
        if (active.bathrooms != null)
          details.push(`<span>${active.bathrooms} WC</span>`);
        if (active.floor != null)
          details.push(`<span>${active.floor}º andar</span>`);

        const locationParts = [
          active.parish,
          active.municipality,
          active.district,
        ].filter(Boolean);

        this._propertiesMeta.innerHTML = `
          <div class="prop-title">${this._escapeHtml(active.title || active.typology || 'Property')}</div>
          <div class="prop-price">${this._formatPrice(active.price, active.priceType)}</div>
          <div class="prop-detail">${details.join('')}</div>
          ${features.length > 0 ? `<div class="prop-features">${features.map((f) => `<span class="prop-feature-tag">${this._escapeHtml(f)}</span>`).join('')}</div>` : ''}
          <div class="prop-location">${this._escapeHtml(locationParts.join(', '))}</div>
        `;
      }

      if (this._propertiesLink && active.url) {
        this._propertiesLink.href = active.url;
        this._propertiesLink.style.display = '';
      } else if (this._propertiesLink) {
        this._propertiesLink.style.display = 'none';
      }

      if (this._propertiesPanel?.classList.contains('collapsed')) {
        this.actions?.setPanelCollapsed?.('properties-panel', false, {
          animate: true,
        });
      }
    } else {
      if (this._propertiesPhoto) this._propertiesPhoto.removeAttribute('src');
      if (this._propertiesPhotoCounter)
        this._propertiesPhotoCounter.textContent = '';
      if (this._propertiesPhotoPrev)
        this._propertiesPhotoPrev.style.display = 'none';
      if (this._propertiesPhotoNext)
        this._propertiesPhotoNext.style.display = 'none';
      if (this._propertiesMeta) this._propertiesMeta.innerHTML = '';
      if (this._propertiesLink) this._propertiesLink.style.display = 'none';
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listeners.abort();
    this._propertiesUnsubscribe?.();
    this._propertiesUnsubscribe = null;
  }
}
