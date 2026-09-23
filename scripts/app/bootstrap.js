/*
页面启动逻辑。
负责解除预加载状态、更新页脚年份、获取一言并启动樱花背景。
*/
(function (window, document) {
	"use strict";

	var namespace = (window.PersonalSakuraGuide = window.PersonalSakuraGuide || {});
	var activeRenderer = null;
	var preloadDelay = 100;
	var hitokotoEndpoint = "https://international.v1.hitokoto.cn/?encode=json";

	function initializeRenderer() {
		if (typeof namespace.createSakuraRenderer !== "function") {
			return;
		}

		activeRenderer = namespace.createSakuraRenderer();

		if (!activeRenderer.init()) {
			activeRenderer = null;
		}
	}

	function removePreloadState() {
		window.setTimeout(function () {
			document.body.classList.remove("is-preload");
		}, preloadDelay);
	}

	function updateCurrentYear() {
		var yearNode = document.querySelector("[data-current-year]");

		if (!yearNode) {
			return;
		}

		yearNode.textContent = String(new Date().getFullYear());
	}

	function loadHitokoto() {
		var taglineNode = document.querySelector(".hero__tagline");

		if (!taglineNode || typeof window.fetch !== "function") {
			return;
		}

		window.fetch(hitokotoEndpoint, {
			method: "GET",
			cache: "no-store",
			headers: {
				Accept: "application/json"
			}
		})
			.then(function (response) {
				if (!response.ok) {
					throw new Error("Hitokoto request failed: " + response.status);
				}

				return response.json();
			})
			.then(function (data) {
				if (data && typeof data.hitokoto === "string" && data.hitokoto.trim()) {
					taglineNode.textContent = data.hitokoto.trim();
				}
			})
			.catch(function (error) {
				if (window.console && typeof window.console.warn === "function") {
					window.console.warn("无法获取一言内容。", error);
				}
			});
	}

	function bootstrap() {
		updateCurrentYear();
		loadHitokoto();
		initializeRenderer();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", bootstrap, false);
	} else {
		bootstrap();
	}

	if (document.readyState === "complete") {
		removePreloadState();
	} else {
		window.addEventListener("load", removePreloadState, { once: true });
	}

	namespace.app = namespace.app || {};
	namespace.app.getRenderer = function () {
		return activeRenderer;
	};

	namespace.runtime = namespace.runtime || {};
	namespace.runtime.getRenderer = namespace.app.getRenderer;
})(window, document);
