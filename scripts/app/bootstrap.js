/*
页面启动逻辑。
负责解除预加载状态、更新页脚年份、获取一言并启动樱花背景。
*/
(function (window, document) {
	"use strict";

	var namespace = (window.PersonalSakuraGuide = window.PersonalSakuraGuide || {});
	var activeRenderer = null;
	var introDuration = 1300; /* --duration-intro(0.75s) + 过渡延迟(0.25s) + 收尾余量 */
	var preloadDelay = 100;
	var hitokotoEndpoints = [
		"https://v1.hitokoto.cn/?encode=json",
		"https://international.v1.hitokoto.cn/?encode=json",
	];

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
			scheduleIntroEnd();
		}, preloadDelay);
	}

	/*
	展开动画跑完之后撤掉 is-intro，把过渡交还给滚动折叠，
	否则 .hero__content-inner 上的过渡会拖慢 --fold 的跟随。
	*/
	function scheduleIntroEnd() {
		window.setTimeout(function () {
			document.body.classList.remove("is-intro");
		}, introDuration);
	}

	function updateCurrentYear() {
		var yearNode = document.querySelector("[data-current-year]");

		if (!yearNode) {
			return;
		}

		yearNode.textContent = String(new Date().getFullYear());
	}

	function requestHitokoto(endpointIndex, taglineNode) {
		if (endpointIndex >= hitokotoEndpoints.length) {
			return Promise.reject(new Error("All Hitokoto requests failed."));
		}

		return window
			.fetch(hitokotoEndpoints[endpointIndex], {
				method: "GET",
				cache: "no-store",
				headers: {
					Accept: "application/json",
				},
			})
			.then(function (response) {
				if (!response.ok) {
					throw new Error("Hitokoto request failed: " + response.status);
				}

				return response.json();
			})
			.then(function (data) {
				if (!data || typeof data.hitokoto !== "string" || !data.hitokoto.trim()) {
					throw new Error("Invalid Hitokoto response.");
				}

				taglineNode.textContent = data.hitokoto.trim();

				if (typeof window.CustomEvent === "function") {
					document.dispatchEvent(new window.CustomEvent("app:taglinechange"));
				}
			})
			.catch(function (error) {
				return requestHitokoto(endpointIndex + 1, taglineNode).catch(function (fallbackError) {
					throw fallbackError || error;
				});
			});
	}

	function loadHitokoto() {
		var taglineNode = document.querySelector(".hero__tagline");

		if (!taglineNode || typeof window.fetch !== "function") {
			return;
		}

		requestHitokoto(0, taglineNode).catch(function (error) {
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
