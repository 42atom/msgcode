const fetchButton = document.getElementById("fetch-channel-people");
const emptyState = document.getElementById("people-empty-state");
const workspaceView = document.getElementById("people-workspace");
const channelList = document.getElementById("channel-people-list");
const addressBookList = document.getElementById("address-book-list");
const modal = document.getElementById("person-edit-modal");
const modalForm = document.getElementById("person-edit-form");
const modalTitleInput = document.getElementById("person-edit-title-input");
const modalTagsInput = document.getElementById("person-edit-tags-input");
const modalNoteInput = document.getElementById("person-edit-note-input");
const modalCancel = document.getElementById("person-edit-cancel");
const modalCancelTop = document.getElementById("person-edit-cancel-top");
const modalCloseX = document.getElementById("person-edit-close-x");

let activePersonCard = null;

if (fetchButton && emptyState && workspaceView) {
  fetchButton.addEventListener("click", () => {
    emptyState.classList.add("is-hidden");
    workspaceView.classList.remove("people-layout--hidden");
  });
}

if (channelList && addressBookList) {
  channelList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("js-save-person")) return;

    const card = target.closest("[data-person-key]");
    if (!(card instanceof HTMLElement)) return;

    const title = card.querySelector("h5")?.textContent ?? "未知人物";
    const meta = card.querySelector("p")?.textContent ?? "";
    const unifiedTitle = "未命名人物";
    const tags = ["待标注"];
    const emptyInline = addressBookList.querySelector(".empty-inline");
    if (emptyInline) emptyInline.remove();

    const personCard = document.createElement("article");
    personCard.className = "person-card";
    personCard.dataset.tags = tags.join(",");
    personCard.innerHTML = `
      <div class="person-head">
        <div>
          <h5>${unifiedTitle}</h5>
          <p>统一称谓：${unifiedTitle}</p>
        </div>
        <button class="ghost-mini js-edit-person">编辑</button>
      </div>
      <div class="tag-chip-list">
        ${tags.map((tag) => `<span class="tag-chip">${tag}</span>`).join("")}
      </div>
      <p class="person-note">备注：由渠道人物手工存入通讯录。</p>
      <div class="channel-chip-list">
        <span class="channel-chip">${title} · ${meta}</span>
      </div>
    `;

    addressBookList.appendChild(personCard);
    card.remove();

    if (!channelList.children.length) {
      const empty = document.createElement("div");
      empty.className = "empty-inline";
      empty.textContent = "当前没有待处理的渠道人物。";
      channelList.appendChild(empty);
    }
  });
}

function openEditModal(card) {
  if (!(card instanceof HTMLElement) || !(modal instanceof HTMLElement)) return;
  activePersonCard = card;
  const titleEl = card.querySelector("h5");
  const noteEl = card.querySelector(".person-note");
  const tags = card.dataset.tags ?? "";
  if (modalTitleInput instanceof HTMLInputElement) {
    modalTitleInput.value = titleEl?.textContent ?? "";
  }
  if (modalTagsInput instanceof HTMLInputElement) {
    modalTagsInput.value = tags;
  }
  if (modalNoteInput instanceof HTMLTextAreaElement) {
    const noteText = (noteEl?.textContent ?? "").replace(/^备注：/, "");
    modalNoteInput.value = noteText;
  }
  modal.classList.remove("is-hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeEditModal() {
  if (!(modal instanceof HTMLElement)) return;
  activePersonCard = null;
  modal.classList.add("is-hidden");
  modal.setAttribute("aria-hidden", "true");
}

if (addressBookList) {
  addressBookList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("js-edit-person")) return;
    const card = target.closest(".person-card");
    openEditModal(card);
  });
}

if (modalCancel instanceof HTMLButtonElement) {
  modalCancel.addEventListener("click", closeEditModal);
}

if (modalCancelTop instanceof HTMLButtonElement) {
  modalCancelTop.addEventListener("click", closeEditModal);
}

if (modalCloseX instanceof HTMLButtonElement) {
  modalCloseX.addEventListener("click", closeEditModal);
}

if (modal instanceof HTMLElement) {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeEditModal();
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal instanceof HTMLElement && !modal.classList.contains("is-hidden")) {
    closeEditModal();
  }
});

if (modalForm instanceof HTMLFormElement) {
  modalForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!(activePersonCard instanceof HTMLElement)) return;
    const titleEl = activePersonCard.querySelector("h5");
    const subtitleEl = activePersonCard.querySelector(".person-head p");
    const noteEl = activePersonCard.querySelector(".person-note");
    if (titleEl && modalTitleInput instanceof HTMLInputElement) {
      titleEl.textContent = modalTitleInput.value.trim() || "未命名人物";
    }
    if (subtitleEl && modalTitleInput instanceof HTMLInputElement) {
      const value = modalTitleInput.value.trim() || "未命名人物";
      subtitleEl.textContent = `统一称谓：${value}`;
    }
    if (noteEl && modalNoteInput instanceof HTMLTextAreaElement) {
      noteEl.textContent = `备注：${modalNoteInput.value.trim() || "无"}`;
    }
    if (modalTagsInput instanceof HTMLInputElement) {
      const tags = modalTagsInput.value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      activePersonCard.dataset.tags = tags.join(",");
      const tagList = activePersonCard.querySelector(".tag-chip-list");
      if (tagList) {
        tagList.innerHTML = tags.length
          ? tags.map((tag) => `<span class="tag-chip">${tag}</span>`).join("")
          : `<span class="tag-chip tag-chip--muted">未标注</span>`;
      }
    }
    closeEditModal();
  });
}
