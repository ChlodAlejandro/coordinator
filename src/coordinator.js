/*
 * Coordinator
 *
 * More information on the userscript itself can be found at [[User:Chlod/Scripts/Coordinator]].
 */
// <nowiki>

mw.loader.using([
    "oojs-ui-core",
    "oojs-ui-windows",
    "oojs-ui-widgets",
    "mediawiki.api",
    "mediawiki.util"
], async function() {

    // =============================== STYLES =================================

    mw.util.addCSS(`
        #coordinates.coord-missing > a {
            font-style: italic;
        }
        
        #coordinator {
            text-align: left;
        }

        #coordinator .map {
            width: 100%;
            height: 70vh;
            max-height: 300px;
        }
        
        #coordinator .coordinator-section {
            width: 100%;
            display: flex;
            margin-bottom: 8px;
            overflow: hidden;
        }
        
        #coordinator .coordinator-section-header b {
            text-transform: uppercase;
            text-align: center;
            flex: 4;
            margin: 0 8px;
            border-bottom: 1px solid gray;
        }
        
        #coordinator .coordinator-section-decimal .oo-ui-textInputWidget {
            flex: 4;
        }
        
        #coordinator .coordinator-section-dms .oo-ui-textInputWidget {
            flex: 1;
        }
        
        #coordinator .coordinator-section-options {
            align-items: end;
        }
        
        #coordinator .coordinator-section-options .oo-ui-fieldLayout {
            margin-top: 0;
            flex: 1;
        }
        
        #coordinator .coordinator-section-options .oo-ui-fieldLayout + .oo-ui-fieldLayout {
            margin-left: 12px;
        }
        
        #coordinator .coordinator-section-action {
            justify-content: end;
        }
        
        #coordinator .coordinator-section-options .coordinator-fieldGroup-display {
            flex: initial;
        }
    `);

    // ============================== CONSTANTS ===============================

    /**
     * Advert for edit summaries.
     * @type {string}
     */
    const advert = "([[User:Chlod/Scripts/Coordinator|coordinator]])";

    /**
     * URL to the Leaflet JS file. This should be using the Toolforge
     * CDNJS mirror for privacy assurance.
     * @type {string}
     */
    const leafletJS = "https://tools-static.wmflabs.org/cdnjs/ajax/libs/leaflet/1.7.1/leaflet.js";
    /**
     * URL to the Leaflet CSS file. This should be using the Toolforge
     * CDNJS mirror for privacy assurance.
     * @type {string}
     */
    const leafletCSS = "https://tools-static.wmflabs.org/cdnjs/ajax/libs/leaflet/1.7.1/leaflet.css";
    /**
     * URL to a JavaScript file that provides a ParsoidDocument.
     * @type {string}
     */
    const parsoidDocumentJS = "https://en.wikipedia.org/wiki/User:Chlod/Scripts/ParsoidDocument.js?action=raw&ctype=text/javascript";

    /**
     * Tile server URL and attribution information.
     * @type {{url: string, attribution: string}}
     */
    const tileServer = {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: "&copy; <a href=\"https://openstreetmap.org/copyright\">OpenStreetMap contributors</a>"
    };

    /**
     * {{coord missing}} or {{coord}} template.
     */
    const coord = document.querySelector("#coordinates");

    /**
     * Internationalization strings.
     * @type {Object}
     */
    const i18n = {
        add: "add missing coordinates",
        edit: "edit",
        add_pre: "(",
        add_post: ")",
        switch_dms: "DMS",
        switch_dms_long: "Use degrees, minutes, and seconds",
        latitude: "latitude",
        longitude: "longitude",
        inline: "Inline",
        title: "Title",
        display: "Display",
        parameters: "Coordinate parameters",
        parameters_help: "Template:Coord#Coordinate parameters",
        name: "Name",
        template_not_found: `We couldn't find the {{{{{0}}}}} template anywhere in the page. Please edit the page manually.`,
        save_error: "Something wrong happened when saving the page: {{{0}}}",
        summary_add: `Adding page coordinates ${advert}`,
        summary_modify: `Adding page coordinates ${advert}`
    };

    /**
     * Default options for the editing popup.
     * @type {Object}
     */
    const defaults = {
        dms: false
    };

    /**
     * Relevant templates for operation. These MUST begin with `Template:`
     * no matter the language; MediaWiki will automatically handle namespace
     * localization.
     * @type {{coord: string, coord_missing: string}}
     */
    const templates = {
        coord: "Template:Coord",
        coord_missing: "Template:Coord missing"
    };

    // =========================== HELPER FUNCTIONS ===========================

    /**
     * Converts decimal-form degrees (0.12345) to degree-minute-second form. This avoids
     * JavaScript numerical errors, which affect division and modulo operations.
     *
     * @param {number} decimal The decimal to convert
     * @returns {[number, number, number, number]} The coordinates in sign-degree-minute-second form.
     */
    function decToDMS(decimal) {
        // -37.7891
        const sign = Math.sign(decimal); // -1.0
        const degrees = Math.floor(Math.abs(decimal)); // 37.0
        const minutesDecimal = Math.abs(decimal) - degrees; // 0.7891
        const minutesFull = minutesDecimal * 60; // 47.346
        const minutes = Math.floor(minutesFull); // 47.0
        const secondsDecimal = minutesFull - minutes; // 0.346
        const secondsFull = secondsDecimal * 60; // 20.76
        const seconds = Math.round(secondsFull); // 21.0

        return isNaN(degrees + minutes + seconds) ? NaN : [sign, degrees, minutes, seconds]; // [37, 47, 21]
    }

    /**
     * Converts degree-minute-second form to decimal-form degrees (0.12345). This avoids
     * JavaScript numerical errors, which affect division and modulo operations.
     *
     * @param {[number, number, number]} dms A tuple containing the degree, minute,
     *                                       and second to convert (respectively)
     * @returns {number} The coordinates in decimal form.
     */
    function dmsToDec(dms) {
        const [degree, minutes, seconds] = dms;
        return degree + (minutes / 60) + (seconds / 3600);
    }

    /**
     * Extracts the number value from the start of a string.
     * @param {string} string A string containing a number (or decimal) at the start.
     * @param {boolean} allowDecimal `true` if decimals are allowed.
     */
    function extractNumberValue(string, allowDecimal = true) {
        return string.replace(new RegExp(allowDecimal ? "[^\\d.]" : "[^\\d]", "g"), "");
    }

    // ============================== SINGLETONS ==============================

    /**
     * The WindowManager for this userscript.
     */
    const windowManager = new OO.ui.WindowManager();
    document.body.appendChild(windowManager.$element[0]);

    /**
     * MediaWiki API class.
     * @type {mw.Api}
     */
    const api = new mw.Api();

    /**
     * The PopupWidget that handles the editor.
     */
    let popupWidget;

    /**
     * The Leaflet map used to graphically select a coordinate.
     */
    let map;

    /**
     * The Leaflet map marker.
     */
    let marker;

    /**
     * The current coordinate values
     */
    let current = {
        lat: null,
        lon: null,
        dms: false,
        inline: false,
        title: true,
        name: null,
        parameters: null,
        fromMissing: false,
        notes: null,
        qid: null
    };

    /**
     * The ParsoidDocument for this page.
     * @type ParsoidDocument
     */
    let parsoidDocument;

    /**
     * The redirects for the Coord and Coord missing templates.
     */
    let templateRedirects = {};

    // =========================== PROCESS FUNCTIONS ==========================

    /**
     * Generates the "params" object for an element's `data-mw`.
     */
    function constructCoordParameters() {
        const positionalParameters = [];
        if (current.dms) {
            const [latSign, latDegree, latMinute, latSeconds] = decToDMS(current.lat);
            const [lonSign, lonDegree, lonMinute, lonSeconds] = decToDMS(current.lon);
            positionalParameters.push(
                latDegree, latMinute, latSeconds, latSign === -1 ? "S" : "N",
                lonDegree, lonMinute, lonSeconds, lonSign === -1 ? "W" : "E"
            );
        } else {
            positionalParameters.push(
                current.lat.toFixed(5), current.lon.toFixed(5)
            );
        }
        if (current.parameters != null)
            positionalParameters.push(current.parameters);

        const parameters = {};
        for (let i = 0; i < positionalParameters.length; i++) {
            parameters[`${i + 1}`] = { wt: `${positionalParameters[i]}` };
        }

        if (current.inline && current.title) {
            parameters["display"] = { wt: "inline,title" };
        } else if (!current.inline) {
            parameters["display"] = { wt: "title" }
        }
        if (current.name != null)
            parameters["name"] = { wt: current.name };
        if (current.notes != null)
            parameters["notes"] = { wt: current.notes };
        if (current.qid != null)
            parameters["qid"] = { wt: current.qid };

        return parameters;
    }

    /**
     * Loads the aliases for the coord and coord_missing templates.
     * @returns {Promise<void>}
     */
    async function loadTemplateAliases() {
        return api.get({
            action: "query",
            format: "json",
            prop: "linkshere",
            titles: Object.values(templates).join("|"),
            utf8: 1,
            formatversion: "2",
            lhprop: "title",
            lhshow: "redirect",
            lhlimit: "500"
        }).then(({query}) => {
            query["pages"].forEach((page) => {
                templateRedirects[page.title] = page["linkshere"].map(v => v.title);
            });
        });
    }

    /**
     * Initialize the ParsoidDocument for this userscript.
     * @returns {Promise<void>}
     */
    async function parsoidStartup() {
        if (parsoidDocument == null) {
            parsoidDocument = new ParsoidDocument();
            document.body.appendChild(parsoidDocument.buildFrame());
        } else {
            parsoidDocument.resetFrame();
        }
        await parsoidDocument.loadFrame(mw.config.get("wgPageName"));
    }

    /**
     * Saves the new coordinates to the most suitable template.
     */
    async function saveToCoordTemplate() {
        await parsoidStartup();

        if (current.fromMissing) {
            const target = parsoidDocument.document.querySelector("#coordinates.coord-missing[data-mw]");
            if (target == null) {
                OO.ui.alert(
                    i18n.template_not_found
                        .replace("{{{0}}}", templates.coord_missing.replace(/^Template:/, ""))
                );
                return;
            }

            /** @type {{parts: any[]}} */
            const mwData = JSON.parse(target.getAttribute("data-mw"));

            const part = mwData.parts.find(part => {
                return part.template != null
                    && [templates.coord_missing, ...templateRedirects[templates.coord_missing]]
                        .map(v => "./" + v.replace(/\s/g, "_").toLowerCase())
                        .includes(part.template.target.href.toLowerCase());
            });

            if (!part) {
                OO.ui.alert(i18n.template_not_found.replace("{{{0}}}", templates.coord_missing.replace(/^Template:/, "")));
                return;
            }

            part.template.target.wt = templates.coord.replace(/^Template:/, "");
            part.template.params = constructCoordParameters();
            target.setAttribute("data-mw", JSON.stringify(mwData));
        } else if (parsoidDocument.document.querySelector("#coordinates") != null) {
            const target = parsoidDocument.findParsoidNode(
                parsoidDocument.document.querySelector("#coordinates")
            );
            if (target == null) {
                OO.ui.alert(
                    i18n.template_not_found
                        .replace("{{{0}}}", templates.coord.replace(/^Template:/, ""))
                );
                return;
            }

            /** @type {{parts: any[]}} */
            const mwData = JSON.parse(target.getAttribute("data-mw"));

            const part = mwData.parts.find(part => {
                return part.template != null
                    && [templates.coord, ...templateRedirects[templates.coord]]
                        .map(v => "./" + v.replace(/\s/g, "_").toLowerCase())
                        .includes(part.template.target.href.toLowerCase());
            });

            if (!part) {
                OO.ui.alert(i18n.template_not_found.replace("{{{0}}}", templates.coord.replace(/^Template:/, "")));
                return;
            }

            part.template.params = constructCoordParameters();
            target.setAttribute("data-mw", JSON.stringify(mwData));
        } else {
            // Guess the best place for the coordinates.
            const bestSpot = (() => {
                function last(array) { return array[array.length - 1]; }

                const pd = parsoidDocument.document;
                /**
                 * This order is based on [[WP:ORDER]]. It looks for the lowest place it can be
                 * put.
                 * @type {[InsertPosition, HTMLElement|null][]}
                 */
                const possibleSpots = [
                    // Before {{DEFAULTSORT}}
                    ["beforebegin", pd.querySelector("[property=\"mw:PageProp/categorydefaultsort\"]")],
                    // Before categories
                    ["beforebegin", pd.querySelector("[rel=\"mw:PageProp/Category\"]")],
                    // Before stub templates
                    ["beforebegin", pd.querySelector(".stub")],
                    // After {{authority control}}
                    ["afterend", last(pd.querySelectorAll(".authority-control"))],
                    // After {{taxon bar}}
                    ["afterend", last(pd.querySelectorAll(".navbox[aria-labelledby=\"Taxon_identifiers\"]"))],
                    // After {{portal bar}}
                    ["afterend", last(pd.querySelectorAll(".portal-bar"))],
                    // After the last navbox
                    ["afterend", last(pd.querySelectorAll(".navbox"))],
                    // After the succession box
                    ["afterend", last(pd.querySelectorAll(".succession-box"))],
                    // Before {{Improve categories}}. This is placed at the very end since this template
                    // is sometimes used at the start of the page, rather than at the end.
                    ["beforebegin", pd.querySelector(".box-Improve_categories")],
                    // The very bottom of the page.
                    ["beforeend", last(pd.querySelectorAll("section"))]
                ];

                for (const spot of possibleSpots) {
                    if (spot[1] != null)
                        return spot;
                }
                return null;
            })();

            const template = document.createElement("span");
            template.setAttribute("about", `N${Math.floor(Math.random * 1000)}`);
            template.setAttribute("typeof", "mw:Transclusion");
            template.setAttribute("data-mw", JSON.stringify({
                parts: [{
                    template: {
                        target: {
                            wt: templates.coord.replace(/^Template:/, ""),
                            href: "./" + templates.coord.replace(/\s/g, "_")
                        },
                        params: constructCoordParameters(),
                        i: 0
                    }
                }]
            }));

            parsoidDocument.findParsoidNode(bestSpot[1]).insertAdjacentElement(bestSpot[0], template);
        }

        const wikitext = await parsoidDocument.toWikitext();

        await api.postWithEditToken({
            action: "edit",
            format: "json",
            title: mw.config.get("wgPageName"),
            utf8: 1,
            formatversion: "2",
            text: wikitext,
            summary: current.fromMissing ? i18n.summary_add : i18n.summary_modify
        });
    }

    /**
     * Spawns the editing popup. Should only be run once.
     * @returns {Promise<HTMLElement>}
     */
    async function spawnEditingPopup() {
        const popupContent = document.createElement("div");
        popupContent.style.marginRight = "8px";

        const headerSection = document.createElement("div");
        headerSection.classList.add("coordinator-section");
        headerSection.classList.add("coordinator-section-header");
        const headerLatitude = document.createElement("b");
        headerLatitude.innerText = i18n.latitude;
        const headerLongitude = document.createElement("b");
        headerLongitude.innerText = i18n.longitude;
        headerSection.appendChild(headerLatitude);
        headerSection.appendChild(headerLongitude);
        popupContent.appendChild(headerSection);

        const decimalSection = document.createElement("div");
        decimalSection.classList.add("coordinator-section");
        decimalSection.classList.add("coordinator-section-decimal");
        const latDecimal = new OO.ui.TextInputWidget({ value: "0", validate: /^[0-9.\-]+$/g });
        const lonDecimal = new OO.ui.TextInputWidget({ value: "0", validate: /^[0-9.\-]+$/g });

        /**
         * Update the decimal fields from a latitude and longitude.
         */
        function updateDecimalFields(lat, lon) {
            latDecimal.setValue(lat.toFixed(4));
            lonDecimal.setValue(lon.toFixed(4));
        }

        /**
         * Updates the map and DMS fields from the decimal values.
         */
        function updateFromDecimalFields() {
            const lat = +latDecimal.getValue();
            const lon = +lonDecimal.getValue();
            current.lat = lat;
            current.lon = lon;
            updateDMSFields(decToDMS(lat), decToDMS(lon));
            marker.setLatLng([ lat, lon ]);
        }

        [latDecimal, lonDecimal].forEach((textInput) => {
            const textInputElement = textInput.$element[0].querySelector("input");
            textInputElement.addEventListener("keydown", (event) => {
                const allow =
                    // Permit most control keys
                    event.key.length > 1
                    || /^[0-9.\-]$/.test(event.key); // Only allow -, ., and numbers.
                if (!allow) event.preventDefault();
                return allow;
            });
            textInputElement.addEventListener("keypress", () => {
                // Map marker modifier is placed here since this is not affected by external changes.
                setTimeout(() => {
                    // Placed in setTimeout to allow keypress event to finish propagating.
                    updateFromDecimalFields();
                });
            });
            decimalSection.appendChild(textInput.$element[0]);
        });
        popupContent.appendChild(decimalSection);

        const dmsSection = document.createElement("div");
        dmsSection.classList.add("coordinator-section");
        dmsSection.classList.add("coordinator-section-dms");
        const latDMSDegree = new OO.ui.TextInputWidget({ value: "0" });
        const latDMSMinute = new OO.ui.TextInputWidget({ value: "0" });
        const latDMSSecond = new OO.ui.TextInputWidget({ value: "0" });
        const latDMSDirection = new OO.ui.TextInputWidget({ value: "N" });
        const lonDMSDegree = new OO.ui.TextInputWidget({ value: "0" });
        const lonDMSMinute = new OO.ui.TextInputWidget({ value: "0" });
        const lonDMSSecond = new OO.ui.TextInputWidget({ value: "0" });
        const lonDMSDirection = new OO.ui.TextInputWidget({ value: "E" });

        /**
         * Update the DMS fields from a DMS-format latitude and longitude.
         */
        function updateDMSFields(
            [ latSign, latDegree, latMinute, latSecond ],
            [ lonSign, lonDegree, lonMinute, lonSecond ]
        ) {
            latDMSDegree.setValue(Math.abs(latDegree));
            latDMSMinute.setValue(latMinute);
            latDMSSecond.setValue(latSecond);
            latDMSDirection.setValue(latSign === -1 ? "S" : "N");
            lonDMSDegree.setValue(Math.abs(lonDegree));
            lonDMSMinute.setValue(lonMinute);
            lonDMSSecond.setValue(lonSecond);
            lonDMSDirection.setValue(lonSign === -1 ? "W" : "E");
        }
        /**
         * Updates the map and decimal fields from the DMS values.
         */
        function updateFromDMSFields() {
            const lat = dmsToDec([
                +extractNumberValue(latDMSDegree.getValue()),
                +extractNumberValue(latDMSMinute.getValue()),
                +extractNumberValue(latDMSSecond.getValue())
            ]);
            const lon = dmsToDec([
                +extractNumberValue(lonDMSDegree.getValue()),
                +extractNumberValue(lonDMSMinute.getValue()),
                +extractNumberValue(lonDMSSecond.getValue())
            ]);

            if (!isNaN(lat + lon)) {
                current.lat = lat;
                current.lon = lon;
                updateDecimalFields(lat, lon);
                marker.setLatLng([lat, lon]);
            }
        }

        const dmsDirectionFields = [[latDMSDirection, "NS"], [lonDMSDirection, "WE"]];
        dmsDirectionFields.forEach(([textInput, allowedDirections]) => {
            const textInputElement = textInput.$element[0].querySelector("input");
            textInputElement.addEventListener("keydown", (event) => {
                const allow =
                    // Permit most control keys
                    event.key.length > 1
                    || new RegExp(`^[${allowedDirections}]$`, "i").test(event.key);
                if (!allow) event.preventDefault(); // Banned key
                else if (event.code.startsWith("Key")) {
                    // Due to the earlier check, we can assume that this is a cardinal direction key.
                    textInputElement.value = event.key.toUpperCase();
                    // Prevent the letter from actually being input.
                    event.preventDefault();
                }
                return allow;
            });
            textInputElement.addEventListener("keypress", () => {
                // Map marker modifier is placed here since this is not affected by external changes.
                setTimeout(() => {
                    // Placed in setTimeout to allow keypress event to finish propagating.
                    updateFromDMSFields();
                });
            });
        });

        /** @type [any, string, boolean][] */
        const dmsLatFields = [
            [latDMSDegree, "\u00b0", false],
            [latDMSMinute, "\u2032", false],
            [latDMSSecond, "\u2033", true]
        ];
        const dmsLonFields = [
            [lonDMSDegree, "\u00b0", false],
            [lonDMSMinute, "\u2032", false],
            [lonDMSSecond, "\u2033", true],
        ];
        function upgradeDMSFieldset(fieldset) {
            fieldset.forEach(([textInput, symbol, allowsDecimal]) => {
                const allowsDecimalRegex = allowsDecimal ? "[^\\d.]" : "[^\\d]"

                const textInputElement = textInput.$element[0].querySelector("input");
                textInputElement.addEventListener("keydown", (event) => {
                    const allow =
                        // Prevent all letter keys first. This will leave symbols and numbers
                        // as the only remaining possible `event.key` values.
                        !/^Key/.test(event.code)
                        && !(new RegExp(`^${allowsDecimalRegex}$`)).test(event.key);
                    if (!allow) event.preventDefault();

                    return allow;
                });
                textInputElement.addEventListener("keypress", () => {
                    // Map marker modifier is placed here since this is not affected by external changes.
                    setTimeout(() => {
                        // Placed in setTimeout to allow keypress event to finish propagating.
                        updateFromDMSFields();
                    });
                });
                textInput.on("change", () => {
                    // Reformat the TextInputWidget to remove extraneous letters.
                    const value = extractNumberValue(textInput.getValue(), allowsDecimal);
                    textInput.setValue(value + symbol);
                });

                let value = textInput.getValue();
                if (!value.endsWith(symbol)) {
                    textInput.setValue(value + symbol);
                }

                dmsSection.appendChild(textInput.$element[0]);
            });
        }
        upgradeDMSFieldset(dmsLatFields);
        dmsSection.appendChild(dmsDirectionFields[0][0].$element[0]);
        upgradeDMSFieldset(dmsLonFields);
        dmsSection.appendChild(dmsDirectionFields[1][0].$element[0]);

        popupContent.appendChild(dmsSection);

        const coordOptionsSection = document.createElement("div");
        coordOptionsSection.classList.add("coordinator-section");
        coordOptionsSection.classList.add("coordinator-section-options");
        const coordFormatSwitch = new OO.ui.ToggleButtonWidget({
            label: i18n.switch_dms,
            title: i18n.switch_dms_long
        });
        const coordDisplayInline = new OO.ui.ToggleButtonWidget({ label: i18n.inline });
        const coordDisplayTitle = new OO.ui.ToggleButtonWidget({ label: i18n.title, value: true });
        const coordDisplayGroup = new OO.ui.ButtonGroupWidget({
            items: [
                coordDisplayInline,
                coordDisplayTitle
            ],
            title: i18n.display
        });
        const coordParameters = new OO.ui.TextInputWidget({
            placeholder: i18n.parameters_help
        });
        const coordName = new OO.ui.TextInputWidget({
            placeholder: mw.config.get("wgPageName").replace(/_/, " ")
        });

        coordFormatSwitch.on("change", (dms) => toggleFormat(dms));
        coordDisplayInline.on("change", (state) => { current.inline = state; });
        coordDisplayTitle.on("change", (state) => { current.title = state; });
        coordParameters.on("change", (text) => { current.parameters = text.length === 0 ? null : text });
        coordName.on("change", (text) => { current.name = text.length === 0 ? null : text });

        coordOptionsSection.appendChild(coordFormatSwitch.$element[0]);
        coordOptionsSection.appendChild(new OO.ui.FieldLayout(coordDisplayGroup, {
            classes: ["coordinator-fieldGroup-display"],
            label: i18n.display,
            align: "top"
        }).$element[0]);
        coordOptionsSection.appendChild(new OO.ui.FieldLayout(coordParameters, {
            label: i18n.parameters,
            align: "top"
        }).$element[0]);
        coordOptionsSection.appendChild(new OO.ui.FieldLayout(coordName, {
            label: i18n.name,
            align: "top"
        }).$element[0]);
        popupContent.appendChild(coordOptionsSection);

        const coordActionSection = document.createElement("div");
        coordActionSection.classList.add("coordinator-section");
        coordActionSection.classList.add("coordinator-section-action");
        const coordSave = new OO.ui.ButtonWidget({
            label: "Save",
            flags: [ "primary", "progressive" ]
        });

        coordSave.on("click", async () => {
            coordSave.setDisabled(true);
            popupWidget.setDisabled(true);
            try {
                await saveToCoordTemplate();
                popupWidget.toggle(false);
                window.location.reload();
            } catch (e) {
                OO.ui.alert(i18n.save_error.replace("{{{0}}}", e.message));
                console.error(e);
            }
            coordSave.setDisabled(false);
            popupWidget.setDisabled(false);
        });

        coordActionSection.appendChild(coordSave.$element[0]);
        popupContent.appendChild(coordActionSection);

        /**
         * Switch between active input fields depending on the format being used.
         * @param {boolean} dms Whether or not the decimal-minute-second format will be used.
         */
        function toggleFormat(dms) {
            current.dms = dms;
            [...dmsLatFields, ...dmsLonFields, ...dmsDirectionFields].forEach(([dmsField]) => {
                dmsField.setDisabled(!dms);
            });
            latDecimal.setDisabled(dms);
            lonDecimal.setDisabled(dms);
            decimalSection.style.height = decimalSection.style.margin = dms ? "0" : "";
            dmsSection.style.height = dmsSection.style.margin = dms ? "" : "0";
            coordFormatSwitch.setValue(dms);
        }

        toggleFormat(defaults.dms);

        const mapElement = document.createElement("div");
        mapElement.classList.add("map");
        popupContent.appendChild(mapElement);

        popupWidget = new OO.ui.PopupWidget({
            $content: $(popupContent),
            padded: true,
            width: 600,
            head: true,
            id: "coordinator",
            hideWhenOutOfView: false
        });

        map = L.map(mapElement).setView([0, 0], 2);
        popupWidget.on("ready", () => map.invalidateSize());
        popupWidget.on("toggle", () => map.invalidateSize());

        L.tileLayer(tileServer.url, {
            maxZoom: 19,
            attribution: tileServer.attribution
        }).addTo(map);

        // Add scale bar.
        L.control.scale({imperial: true, metric: true}).addTo(map);

        // Create draggable marker.
        marker = L.marker([0, 0], {
            draggable: true
        });
        marker.addTo(map);
        marker.addEventListener("drag", () => {
            const { lat, lng: lon} = marker.getLatLng();

            current.lat = lat;
            current.lon = lon;
            updateDecimalFields(lat, lon);
            updateDMSFields(decToDMS(lat), decToDMS(lon));
        });

        /**
         * Updates all fields from a set latitude and longitude.
         * @param lat
         * @param lon
         */
        function updateAll(lat, lon) {
            updateDecimalFields(lat, lon);
            updateDMSFields(decToDMS(lat), decToDMS(lon));
            marker.setLatLng([lat, lon]);
        }

        map.addEventListener("load", () => map.invalidateSize());
        document.addEventListener("scroll", () => map.invalidateSize());

        if (mw.config.get("wgCoordinates")) {
            // Get template data from Parsoid.
            await parsoidStartup();
            const node = parsoidDocument.findParsoidNode(parsoidDocument.document.querySelector("#coordinates"));
            const mwData = JSON.parse(node.getAttribute("data-mw"));
            const part = mwData.parts.find(part => {
                return part.template != null
                    && [templates.coord, ...templateRedirects[templates.coord]]
                        .map(v => "./" + v.replace(/\s/g, "_").toLowerCase())
                        .includes(part.template.target.href.toLowerCase());
            });

            const { lat, lon } = mw.config.get("wgCoordinates");
            current.lat = lat;
            current.lon = lon;
            updateAll(lat, lon);

            if (part.template.params["format"]) {
                current.dms = part.template.params["format"].wt === "dms";
            } else {
                current.dms =  document.querySelector("#coordinates .geo-dms") != null;
            }
            coordFormatSwitch.setValue(current.dms);

            if (part.template.params["display"]) {
                current.inline = part.template.params["display"].wt.includes("inline")
                    || part.template.params["display"] === "t";
                current.title = part.template.params["display"].wt.includes("title")
                    || part.template.params["display"] === "it";
            }
            coordDisplayInline.setValue(current.inline);
            coordDisplayTitle.setValue(current.title);

            for (const [key, value] of Object.entries(part.template.params)) {
                // noinspection JSCheckFunctionSignatures
                if (!isNaN(+key) && /type|scale|dim|region|globe|source/.test(value.wt)) {
                    current.parameters = value.wt;
                    coordParameters.setValue(current.parameters);
                    break;
                }
            }

            if (part.template.params["name"]) {
                current.name = part.template.params["name"].wt;
                coordName.setValue(current.name);
            }
            // Leave these untouched
            if (part.template.params["notes"])
                current.notes = part.template.params["notes"].wt;
            if (part.template.params["qid"])
                current.qid = part.template.params["qid"].wt;
        }

        return popupWidget.$element[0];
    }

    async function openEditingPopup() {
        // Load Leaflet
        mw.loader.load(leafletCSS, "text/css");
        await Promise.all([
            mw.loader.getScript(parsoidDocumentJS),
            mw.loader.getScript(leafletJS),
            loadTemplateAliases()
        ]);

        if (window.ParsoidDocument == null)
            await new Promise((res) => { document.addEventListener("parsoidDocument:load", res); });

        coord.appendChild(await spawnEditingPopup());
        popupWidget.toggle(true);
    }

    // ============================== INITIALIZE ==============================
    if (coord !== null) {
        current.fromMissing = coord.classList.contains("coord-missing");

        const coord_a = document.createElement("a");
        coord_a.setAttribute("href", "javascript:void(0)");
        coord_a.addEventListener("click", () => {
            openEditingPopup();
        });
        coord_a.innerText = current.fromMissing ? i18n.add : i18n.edit;

        coord.append(" " + i18n.add_pre);
        coord.appendChild(coord_a);
        coord.append(i18n.add_post);
    }
});
// </nowiki>
/*
 * Copyright 2021 Chlod
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Also licensed under the Creative Commons Attribution-ShareAlike 3.0
 * Unported License, a copy of which is available at
 *
 *     https://creativecommons.org/licenses/by-sa/3.0
 *
 */
