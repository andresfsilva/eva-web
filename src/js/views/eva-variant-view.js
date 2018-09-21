/*
 * European Variation Archive (EVA) - Open-access database of all types of genetic
 * variation data from all species
 *
 * Copyright 2014, 2015 EMBL - European Bioinformatics Institute
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
function EvaVariantView(args) {
    _.extend(this, Backbone.Events);
    this.id = Utils.genId("EVAVariantView");
    _.extend(this, args);
    this.rendered = false;
    this.render();
}
EvaVariantView.prototype = {
    // Get the list of studies pertinent to the current species
    getStudiesList: function(species) {
        // Get studies list
        var response = EvaManager.get({
            category: 'meta/studies',
            resource: 'list',
            params: {species: species},
            async: false
        });

        try {
            if (response) {
                var _tempStudies = response.response[0].result;
                return _.map(_.keys(_tempStudies), function (key) {
                    if(_.indexOf(DISABLE_STUDY_LINK, this[key].studyId) > -1){
                        this[key].link = false;
                    }else{
                        this[key].link = true;
                    }
                    return this[key];
                }, _tempStudies);
            }
            else {
                return [];
            }

        } catch (e) {
            console.log(e);
        }
    },

    // Get variant type given an RS ID
    getVariantTypeFromRSID: function(rsID) {
        var response = EvaManager.get({
                                     service: ACCESSIONING_SERVICE,
                                     category: "clustered-variants",
                                     resource: rsID.substring(2),
                                     async: false
                                 });
        if (response) {
            return response[0].data.type;
        }
        return '';
    },

    // Get variant representation in the form of Ref/Alt ex: A/T
    getAlleleRepr: function(allele) {
        return (allele === ''? '-':allele);
    },

    addReprToVariantObj: function(variantObj) {
        if (typeof(variantObj.alternate) !== "undefined") {
            variantObj.referenceRepr = this.getAlleleRepr(variantObj.reference);
            variantObj.alternateRepr = this.getAlleleRepr(variantObj.alternate);
            variantObj.repr = variantObj.referenceRepr + "/" + variantObj.alternateRepr;
        }
    },

    // Given the species list and the current species, get the current assembly
    getCurrentAssembly: function(selectedSpecies, speciesList) {
        return _.chain(speciesList)
            .filter(function(speciesAttr) {
                return (speciesAttr.taxonomyCode + "_" + speciesAttr.assemblyCode === selectedSpecies);
            }).value()[0].assemblyAccession;
    },

    // Given the accession category, use the accessioning web service to construct a variant object
    getVariantInfoFromAccessioningService: function(selectedSpecies, speciesList, accessionCategory, accessionID) {
        // Check if two assemblies are equivalent. This is a crude and rudimentary check, however this needs to
        function areAssembliesEquivalent (assemblyAccession1, assemblyAccession2) {
            if (assemblyAccession1 && assemblyAccession2) {
                assemblyAccession1 = assemblyAccession1.trim().toLowerCase();
                assemblyAccession2 = assemblyAccession2.trim().toLowerCase();
                return (assemblyAccession1 === assemblyAccession2 ||
                    assemblyAccession1.replace("gcf", "gca") === assemblyAccession2.replace("gcf", "gca"));
            }
            return false;
        }

        // Use attributes from Accessioning web service response to construct a variant object
        function mapAccessioningServiceResponseToVariantInfo(response) {
            var variantInfo = {};
            var taxonomyIdFromAccessioningService = response.data.taxonomyAccession;
            var assemblyFromAccessioningService = (accessionCategory === "submitted-variants" ?
                                                response.data.referenceSequenceAccession : response.data.assemblyAccession);
            if (!_.isEmpty(speciesList) && typeof taxonomyIdFromAccessioningService !== 'undefined') {
                var speciesObj = _.chain(speciesList)
                            .filter(function(speciesAttr) {
                                return (speciesAttr.taxonomyId === taxonomyIdFromAccessioningService &&
                                        areAssembliesEquivalent(speciesAttr.assemblyAccession, assemblyFromAccessioningService));
                            }).value()[0];
                variantInfo.species = speciesObj.taxonomyCode + "_" + speciesObj.assemblyCode;
                // Do NOT proceed if the variant's species + assembly combination does not match
                // the species dropdown of the search UI
                if (variantInfo.species !== selectedSpecies) {
                    return;
                }
                variantInfo.chromosome = response.data.contig;
                variantInfo.start = response.data.start;
                variantInfo.reference = response.data.referenceAllele;
                if (response.data.alternateAllele) {
                    variantInfo.alternate = response.data.alternateAllele;
                    variantInfo.end = getVariantEndCoordinate(variantInfo.start, response.data.referenceAllele,
                                                                response.data.alternateAllele);
                    variantInfo.associatedRSID = variantInfo.clusteredVariantAccession;
                }

                var booleanOrNullToYesNoEmpty = function(booleanValue) {
                    if (booleanValue === true) {
                        return "Yes";
                    }
                    else if (booleanValue === false) {
                        return "No";
                    }
                    return "";
                };
                variantInfo.evidence = booleanOrNullToYesNoEmpty(response.data.supportedByEvidence);
                variantInfo.assemblyMatch = booleanOrNullToYesNoEmpty(response.data.assemblyMatch);
                variantInfo.allelesMatch = booleanOrNullToYesNoEmpty(response.data.allelesMatch);
                variantInfo.validated = booleanOrNullToYesNoEmpty(response.data.validated);
                if (response.data.createdDate) {
                    var dateObj = new Date(response.data.createdDate);
                    var monthNames = ["January", "February", "March", "April", "May", "June",
                      "July", "August", "September", "October", "November", "December"
                    ];
                    variantInfo.createdDate = monthNames[dateObj.getMonth()] + " " + dateObj.getDate() + ", " +
                                                dateObj.getFullYear();
                }

                if (accessionCategory === "clustered-variants") {
                    variantInfo.id = "rs" + response.accession;
                    variantInfo.associatedSSIDs = getAssociatedSSIDsFromAccessioningService
                                                    (accessionCategory, variantInfo.id).map(function(ssIDInfo) {
                                                        return {"ID": "ss" + ssIDInfo.accession, "Contig": ssIDInfo.data.contig,
                                                                "Start": ssIDInfo.data.start,
                                                                "End": getVariantEndCoordinate(ssIDInfo.data.start,
                                                                        ssIDInfo.data.referenceAllele, ssIDInfo.data.alternateAllele),
                                                                "Reference": ssIDInfo.data.referenceAllele,
                                                                "Alternate": ssIDInfo.data.alternateAllele,
                                                                "Created Date": ssIDInfo.data.createdDate};
                                                    }
                                                  );
                    variantInfo.type = response.data.type;
                }
                if (accessionCategory === "submitted-variants") {
                    variantInfo.id = "ss" + response.accession;
                    variantInfo.type = variantInfo.associatedRSID ? getVariantTypeFromRSID(variantInfo.associatedRSID):'';
                }

                return variantInfo;
            }
        }

        // For a given RS ID, get associated SS ID
        function getAssociatedSSIDsFromAccessioningService (accessionCategory, accessionID) {
             var response = EvaManager.get({
                             service: ACCESSIONING_SERVICE,
                             category: accessionCategory,
                             resource: accessionID.substring(2) + "/submitted",
                             async: false
                         });
             return response;
        }

        // Calculate end coordinate for a variant given start, ref and alt
        function getVariantEndCoordinate (variantStartCoordinate, referenceAllele, alternateAllele) {
            return variantStartCoordinate + Math.max(referenceAllele.length, alternateAllele.length) - 1;
        }

        // Get response from the accessioning web service
        var response = EvaManager.get({
                        service: ACCESSIONING_SERVICE,
                        category: accessionCategory,
                        resource: accessionID.substring(2),
                        async: false
                    });
        try {
            if (typeof response !== 'undefined' && response != null && !_.isEmpty(response)) {
                return response.map(mapAccessioningServiceResponseToVariantInfo);
            }
            else {
                return [];
            }
        } catch (e) {
            console.log(e);
        }
    },

    // Given a position or ssID, use the EVA web service to construct a variant object
    getVariantInfoFromEVAService : function(attributeToSearchBy, queryParams) {
        var webServiceResponse = EvaManager.get({
            category: 'variants',
            resource: 'info',
            query: attributeToSearchBy,
            params: queryParams,
            async: false
        });
        var results = webServiceResponse.response[0].result;
        if (results) {
            results.forEach(function(result) {
                result.associatedRSID = result.ids.filter(function(x) {return x.startsWith("rs");})[0];
                result.associatedSSIDs = result.ids.filter(function(x) {return x.startsWith("ss");});
                result.allAlternates = _.uniq([result.alternate].concat(
                                                _.chain(result.sourceEntries).values().map(function(sourceEntry) {
                                                    return (sourceEntry.secondaryAlternates ?
                                                                sourceEntry.secondaryAlternates : []);
                                                }).flatten().value()
                                        )).join(",");
                // For SS ID details, use all the secondary alternates because
                // it is not possible to get the precise alternate(s) with the EVA webservice
                result.associatedSSIDs = result.associatedSSIDs.map(function(ssID) {
                    return {"ID": ssID, "Contig": result.chromosome,
                            "Start": result.start, "End": result.end,
                            "Reference": result.reference, "Alternate": result.allAlternates, "Created Date": null};
                });
                result.evidence = "Yes";
                if (attributeToSearchBy.startsWith("rs") || attributeToSearchBy.startsWith("ss")) {
                    result.id = attributeToSearchBy;
                }
                else {
                    // For position based searches, return all possible IDs because EVA service
                    // cannot precisely tell the ID
                    result.id = result.ids.filter(function(x) {x.startsWith("ss");}).join(",");
                }
            });
            return results;
        }
        else {
            return [];
        }
    },

    // Test variant objects from the EVA and accessioning service
    areVariantObjectsComparable: function (variantObj1, variantObj2) {
        return (variantObj1.start === variantObj2.start && variantObj1.reference === variantObj2.reference &&
                    variantObj1.alternate === variantObj2.alternate);
    },

    // Process a query based on accession ID
    processQueryWithAccessioningService: function () {
        var _this = this;
        this.accessionCategory = this.accessionID.startsWith("rs") ? "clustered-variants": "submitted-variants";
        this.variant = this.getVariantInfoFromAccessioningService(this.species, this.speciesList, this.accessionCategory, this.accessionID)
                        .filter(function(variantObj) {
                            return !_.isEmpty(variantObj);
                        });

        this.variant.forEach(function(variantObjFromAccService) {
            // A position based query would be more accurate but at this time contigs in
            // the accessioning service is not equivalent to those in the EVA service
            var variantInfoFromEVAService = _this.getVariantInfoFromEVAService(variantObjFromAccService.id, _this.queryParams);
            // Prefer nice chromosome numbers, while it lasts, over ugly contig names from the accessioning service
            var preferredAttributesFromEVAService = ["chromosome"];
            // Match them against the
            matchingVariantInfoFromEVAService = variantInfoFromEVAService.filter(function(variantObjFromEVAService) {
                return _this.areVariantObjectsComparable(variantInfoFromEVAService, variantObjFromAccService);
            })[0];
            for (var key in variantInfoFromEVAService) {
                if (_.contains(preferredAttributesFromEVAService, key) || !(key in variantObjFromAccService) ||
                    typeof(variantObjFromAccService[key]) === 'undefined' ||
                    (variantObjFromAccService[key] === "" && variantObjFromAccService !== "reference" &&
                    variantObjFromAccService !== "alternate")) {
                        variantObjFromAccService[key] = matchingVariantInfoFromEVAService[key];
                }
            }
            variantObjFromAccService.associatedSSIDs.forEach(function(ssIDInfo){
                ssIDInfo.Contig = matchingVariantInfoFromEVAService["chromosome"];
            });
            _this.addReprToVariantObj(variantObjFromAccService);
        });
    },

    processQueryWithEVAService: function () {
        var _this = this;
        var attributeToSearchBy = this.position ? this.position : this.accessionID;
        this.variant = this.getVariantInfoFromEVAService(attributeToSearchBy, this.queryParams)
                            .filter(function(variantObj) {
                                return !_.isEmpty(variantObj);
                            });
        if (this.position) {
            this.variant.forEach(function(variantObjFromEVAService) {
                var matchingVariantFromAccessioningService = _.chain(variantObjFromEVAService.associatedSSIDs).map(function(ssIDInfo) {
                         return _this.getVariantInfoFromAccessioningService(_this.species, _this.speciesList,
                                                                                "submitted-variants", ssIDInfo.ID);
                        }).filter(function(variantObjFromAccService) {
                            return result ?
                                _this.areVariantObjectsComparable(variantObjFromAccService, variantInfoFromEVAService) : false;
                        }).value()[0];
                // Accessioning service is very precise when it comes to alleles for multi-allelics
                var preferredAttributesFromAccessioningService = ["start", "end", "reference", "alternate", "id"];
                for (var key in matchingVariantFromAccessioningService) {
                    if (_.contains(preferredAttributesFromAccessioningService, key) ||
                        !(key in variantObjFromEVAService) || !(variantObjFromEVAService[key])) {
                        variantObjFromEVAService[key] = matchingVariantFromAccessioningService[key];
                    }
                }
                _this.addReprToVariantObj(variantObjFromEVAService);
            });
        }
    },

    render: function () {
        this.targetDiv = (this.target instanceof HTMLElement) ? this.target : document.querySelector('#' + this.target);
        if (!this.targetDiv) {
            console.log('EVA-VariantView: target ' + this.target + ' not found');
            return;
        }

        if(this.annotationVersion){
            var _annotVersion = this.annotationVersion.split("_");
            _.extend(queryParams, {'annot-vep-version':_annotVersion[0]},{'annot-vep-cache-version':_annotVersion[1]});
        }

        this.queryParams = {species: this.species};
        this.studiesList = this.getStudiesList(this.species);
        this.speciesList = getEVASpeciesList();
        this.currAssembly = this.getCurrentAssembly(this.species, this.speciesList);

        if (this.accessionID) {
            this.processQueryWithAccessioningService();
        }
        // Proceed to EVA warehouse query if query is position-based or the above processing fails
        if (this.position || _.isEmpty(this.variant)) {
            this.processQueryWithEVAService();
        }

        this.draw();

        //sending tracking data to Google Analytics
        ga('send', 'event', { eventCategory: 'Views', eventAction: 'Variant', eventLabel:'species='+this.species+'variant='+this.position});
    },
    createVariantFilesPanel: function (targetDiv, variantData) {
        var _this = this;
        var variantFilesPanel = new EvaVariantFilesPanel({
            panelID: variantData.repr ? variantData.repr.replace("/", "_"):'',
            variantAlleles: variantData.repr,
            target: targetDiv,
            height: '',
            handlers: {
                "load:finish": function (e) {
//                    _this.grid.setLoading(false);
                }
            },
            statsTpl: new Ext.XTemplate(
                '<table class="ocb-stats-table" style="width:300px;">' +
                    '<tr>' +
                    '<td class="header">Minor Allele Frequency:</td>' +
                    '<td><tpl if="maf == -1 || maf == 0">NA <tpl else>{maf:number( "0.000" )} </tpl></td>' +
                    '</tr>',
                '<tr>' +
                    '<td class="header">MAF Allele:</td>' +
                    '<td><tpl if="mafAllele">{mafAllele} <tpl else>NA</tpl></td>' +
                    '</tr>',
                '<tr>' +
                    '<tr>' +
                    '<td class="header">Mendelian Errors:</td>' +
                    '<td><tpl if="mendelianErrors == -1">NA <tpl else>{mendelianErrors}</tpl></td>' +
                    '</tr>',
                '<tr>' +
                    '<td class="header">Missing Alleles:</td>' +
                    '<td><tpl if="missingAlleles == -1">NA <tpl else>{missingAlleles}</tpl></td>' +
                    '</tr>',
                '<tr>' +
                    '<td class="header">Missing Genotypes:</td>' +
                    '<td><tpl if="missingGenotypes == -1">NA <tpl else>{missingGenotypes}</tpl></td>' +
                    '</tr>',
                '</table>'
            )
        });

        if (variantData.sourceEntries) {
            variantFilesPanel.load(variantData.sourceEntries, {species: _this.species},  _this.studiesList);
            variantFilesPanel.draw();
        }

        return variantFilesPanel;
    },

    draw: function (data, content) {
        var _this = this;
        var variant = this.variant;

        if(_.isEmpty(variant)){
            var noDataEl = document.querySelector("#summary-grid");
            var noDataElDiv = document.createElement("div");
            noDataElDiv.innerHTML = '<span>No Data Available</span>';
            noDataEl.appendChild(noDataElDiv);
            return;
        }
        var variantViewDiv = document.querySelector("#variantView");
        $(variantViewDiv).addClass('show-div');
        var summaryContent = _this._renderSummaryData(variant);
        var summaryEl = document.querySelector("#summary-grid");
        var summaryElDiv = document.createElement("div");
        summaryElDiv.innerHTML = summaryContent;
        summaryEl.appendChild(summaryElDiv);

        if (this.accessionCategory === "submitted-variants" || this.position) {
            var consqTypeContent = _this._renderConsequenceTypeData(_this.variant);
            if(!_.isUndefined(consqTypeContent) && !_.isEmpty(consqTypeContent)) {
                var consqTypeEl = document.querySelector("#consequence-types-grid");
                var consqTypeElDiv = document.createElement("div");
                consqTypeElDiv.innerHTML = consqTypeContent;
                consqTypeEl.appendChild(consqTypeElDiv);
            }

            var studyEl = document.querySelector("#studies-grid");
            this.variant.forEach(function(variant) {
                var studyElDiv = document.createElement("div");
                studyElDiv.setAttribute('id', "files_" + variant.reference + "_" + variant.alternate);
                studyElDiv.setAttribute('class', 'eva variant-widget-panel ocb-variant-stats-panel');
                studyEl.appendChild(studyElDiv);
                _this.createVariantFilesPanel(studyElDiv, variant);
            });

            var genotypesEl = document.querySelector("#genotypes-grid");
            this.variant.forEach(function(variant) {
                var genotypesElDiv = document.createElement('div');
                genotypesElDiv.setAttribute('id', "genotypes_" + variant.reference + "_" + variant.alternate);
                genotypesElDiv.setAttribute('class', 'ocb-variant-genotype-grid');
                genotypesEl.appendChild(genotypesElDiv);
                var variantData = {repr: variant.repr, sourceEntries: variant.sourceEntries, species: _this.species};
                _this._createVariantGenotypeGridPanel(genotypesElDiv, variantData);
            });

            var popStatsEl = document.querySelector("#population-stats-grid-view");
                this.variant.forEach(function(variant) {
                var popStatsElDiv = document.createElement("div");
                popStatsElDiv.setAttribute('id', "popstats_" + variant.reference + "_" + variant.alternate);
                popStatsElDiv.setAttribute('class', 'eva variant-widget-panel ocb-variant-stats-panel');
                popStatsEl.appendChild(popStatsElDiv);
                var variantData = {repr: variant.repr, sourceEntries: variant.sourceEntries, species: _this.species};
                _this._createPopulationStatsPanel(popStatsElDiv, variantData);
            });
        }
        else {
            document.getElementById("navigation-strip").remove();
        }
    },
    _renderSummaryData: function (data) {
        var _this = this;
        var speciesName, organism;
        if (!_.isEmpty(this.speciesList)) {
            speciesName = _.findWhere(this.speciesList, {taxonomyCode: this.species.split("_")[0]}).taxonomyEvaName;
            organism = speciesName.substr(0, 1).toUpperCase() + speciesName.substr(1);
        } else {
            speciesName = this.species;
        }

        var getSummaryTableHeaderRow = function(summaryData) {
            var header = '';
            _.each(_.keys(summaryData), function(key) {
                if (key === summaryDisplayFields.allelesMatch) {
                    header += '<th><span title="' + allelesMatchToolTip + '">' + key + '</span></th>';
                }
                else {
                    header += '<th>' + key + '</th>';
                }
            });
            return '<thead><tr>' + header + '</tr></thead>';
        };
        var getSummaryTableContentRow = function(summaryData) {
            var rowContent = '';
            _.each(_.keys(summaryData), function(key) {
                var content = summaryData[key] ? summaryData[key]: '';
                rowContent += '<td>' + content + '</td>';
            });
            return '<tr>' + rowContent + '</tr>';
        };

        var summaryDisplayFields = {organism : "Organism", assembly: "Assembly", chromosome: "Contig", start: "Start",
                                    end: "End", reference: "Reference", alternate: "Alternate", id: "ID", orientation: "Orientation",
                                    type: "Type", evidence: "Evidence?", assemblyMatch: "Alleles match reference assembly?",
                                    allelesMatch: "Passed allele checks?",
                                    validated: '<a href="https://www.ncbi.nlm.nih.gov/books/NBK21088/table/ch5.ch5_t4/?report=objectonly" target="_blank">Validated?</a>', createdDate: "Created Date"};
        var allelesMatchToolTip = "1) Reference allele appears in the list of alleles that were submitted and 2) Locus orientation was determined definitively";
        var summaryData = data.map(function(x) {
            var summaryDataObj = {};
            summaryDataObj[summaryDisplayFields.organism] = organism;
            summaryDataObj[summaryDisplayFields.assembly] = _this.currAssembly;
            summaryDataObj[summaryDisplayFields.chromosome] = x.chromosome;
            summaryDataObj[summaryDisplayFields.start] = x.start;
            summaryDataObj[summaryDisplayFields.end] = x.end;
            summaryDataObj[summaryDisplayFields.reference] = _.escape(x.referenceRepr);
            summaryDataObj[summaryDisplayFields.alternate] = _.escape(x.alternateRepr);
            summaryDataObj[summaryDisplayFields.id] = x.id;
            summaryDataObj[summaryDisplayFields.orientation] = "Fwd";
            summaryDataObj[summaryDisplayFields.type] = x.type;
            summaryDataObj[summaryDisplayFields.evidence] = x.evidence;
            summaryDataObj[summaryDisplayFields.assemblyMatch] = x.assemblyMatch;
            summaryDataObj[summaryDisplayFields.allelesMatch] = x.allelesMatch;
            summaryDataObj[summaryDisplayFields.validated] = x.validated;
            summaryDataObj[summaryDisplayFields.createdDate] = x.createdDate;
            return summaryDataObj;
        });
        var _summaryTable = '<h4 class="variant-view-h4">Variant Information</h4><div class="row"><div class="col-md-8">';
        var rsReference = '',
            ssInfoHeaderRow = '',
            ssInfoContentRows = '',
            submitterInfoHeading = '';

        if (this.accessionCategory === "clustered-variants") {
            summaryData = summaryData.map(function(x) {return _.omit(x, [summaryDisplayFields.end, summaryDisplayFields.reference, summaryDisplayFields.alternate,
                                                          summaryDisplayFields.evidence, summaryDisplayFields.assemblyMatch,
                                                          summaryDisplayFields.allelesMatch, summaryDisplayFields.validated]);}).slice(0,1);
            submitterInfoHeading = '<h4 class="variant-view-h4">Submitted Variants</b></h4><div class="row"><div class="col-md-8">';
            var associatedSSData = data[0].associatedSSIDs;
            associatedSSData.forEach(function(x) {
                x.ID = '<a href="?variant&accessionID=' + x.ID + '&species=' + _this.species + '">' + x.ID + '</a>';
            });
            ssInfoHeaderRow = getSummaryTableHeaderRow(associatedSSData[0]);
            ssInfoContentRows = associatedSSData.map(getSummaryTableContentRow).join("");
        }
        else {
            if (data[0].associatedRSID) {
                rsReference = '<small><b>Clustered</b> under <a href="?variant&accessionID=' +
                                data[0].associatedRSID + '&species=' + this.species + '">' +
                                data[0].associatedRSID + '</a></small>';
            }
        }

        var variantInfoHeaderRow = getSummaryTableHeaderRow(summaryData[0]);
        var variantInfoContentRows = summaryData.map(getSummaryTableContentRow).join("");

        _summaryTable += '<table class="table hover" style="font-size: small">' + variantInfoHeaderRow +
                            variantInfoContentRows + '</table>';
        _summaryTable += '</div></div>';
        _summaryTable += ssInfoHeaderRow?
                            submitterInfoHeading + '<table class="table hover" style="font-size: small">' +
                            ssInfoHeaderRow + ssInfoContentRows + '</table>' : '';
        _summaryTable += rsReference;
        _summaryTable += '</div></div>';

        return _summaryTable;

    },
    _renderConsequenceTypeData: function (variantDataArray) {
        var _this = this;
        return variantDataArray.map(function(data) {
            var consequenceTypeHeading = '<h4 class="variant-view-h4"> Consequence Types' + (data.repr ? " for "+data.repr : "") +  '</h4>';
            var noDataAvailableSection = consequenceTypeHeading + '<div style="margin-left:15px;">No Data Available</div>';
            if(_.isUndefined(data.annotation)){
              return noDataAvailableSection;
            }
            var annotation = data.annotation.consequenceTypes;
            if (!annotation) {
                return noDataAvailableSection;
            }
            annotation = annotation.sort(_this._sortBy('ensemblGeneId', _this._sortBy('ensemblTranscriptId')));
            var _consequenceTypeTable = consequenceTypeHeading + '<div class="row"><div><table class="table hover" style="font-size: small">';
            _consequenceTypeTable += '<thead><tr><th>Ensembl Gene ID</th><th>Ensembl Transcript ID</th><th>Accession</th><th>Name</th></tr></thead><tbody>';
            _.each(_.keys(annotation), function (key) {
                var annotationDetails = this[key];
                var soTerms = this[key].soTerms;
                _.each(_.keys(soTerms), function (key) {
                    var link = '<a href="http://www.sequenceontology.org/miso/current_svn/term/' + this[key].soAccession + '" target="_blank">' + this[key].soAccession + '</a>';
                    var so_term_detail = consequenceTypeDetails[soTerms[0].soName];
                    var color = '';
                    var impact = '';
                    var svg = '';
                    if (!_.isUndefined(so_term_detail)) {
                        color = so_term_detail.color;
                        impact = so_term_detail.impact;
                        svg = '<svg width="20" height="10"><rect x="0" y="3" width="15" height="10" fill="' + color + '"><title>' + impact + '</title></rect></svg>';
                    }

                    var ensemblGeneId = '-';
                    if (annotationDetails.ensemblGeneId) {
    //                     ensemblGeneId = '<a href="http://www.ensembl.org/Homo_sapiens/Gene/Summary?g='+annotationDetails.ensemblGeneId+'" target="_blank">'+annotationDetails.ensemblGeneId+'</a>';
                        ensemblGeneId = annotationDetails.ensemblGeneId;
                    }
                    var ensemblTranscriptId = '-';
                    if (annotationDetails.ensemblTranscriptId) {
    //                    ensemblTranscriptId = '<a href="http://www.ensembl.org/Homo_sapiens/transview?transcript='+annotationDetails.ensemblTranscriptId+'" target="_blank">'+annotationDetails.ensemblTranscriptId+'</a>';
                        ensemblTranscriptId = annotationDetails.ensemblTranscriptId;
                    }
                    _consequenceTypeTable += '<tr><td class="variant-view-ensemblGeneId">' + ensemblGeneId + '</td><td class="variant-view-ensemblTranscriptId">' + ensemblTranscriptId + '</td><td class="variant-view-link">' + link + '</td><td class="variant-view-soname">' + this[key].soName + '&nbsp;' + svg + '</td></tr>';
                }, soTerms);

            }, annotation);
            _consequenceTypeTable += '</tbody></table></div></div>';
            return _consequenceTypeTable;
        }).join("");
    },
    _createPopulationStatsPanel: function (target, variantData) {
        var _this = this;
        this.defaultToolConfig = {
            headerConfig: {
                baseCls: 'eva-header-2'
            }
        };
        var variantPopulationStatsPanel = new EvaVariantPopulationStatsPanel({
            panelID: variantData.repr ? variantData.repr.replace("/", "_"):'',
            variantAlleles: variantData.repr,
            target: target,
            customMargin: '0 0 0 0',
            headerConfig: this.defaultToolConfig.headerConfig,
            handlers: {
                "load:finish": function (e) {
                }
            }


        });

        variantPopulationStatsPanel.load(variantData.sourceEntries, {species: variantData.species},  _this.studiesList);
        variantPopulationStatsPanel.draw();

        return variantPopulationStatsPanel;
    },
    _sortBy : function(name, minor){
        return function (o, p) {
            var a, b;
            if (typeof o === 'object' && typeof p === 'object' && o && p) {
                a = o[name];
                b = p[name];
                if (a === b) {
                    return typeof minor === 'function' ? minor(o, p) : o;
                }
                if (typeof a === typeof b) {
                    return a < b ? -1 : 1;
                }
                return typeof a < typeof b ? -1 : 1;
            } else {
                throw {
                    name: 'Error',
                    message: 'Expected an object when sorting by ' + name
                };
            }
        };
    },

    _createVariantGenotypeGridPanel: function (target, variantData) {
        var _this = this;
        var variantGenotypeGridPanel = new EvaVariantGenotypeGridPanel({
            panelID: variantData.repr ? variantData.repr.replace("/", "_"):'',
            variantAlleles: variantData.repr,
            target: target,
            gridConfig: {
                flex: 1,
                layout: {
                    align: 'stretch'
                }
            },
            height: 500
        });

        variantGenotypeGridPanel.load(variantData.sourceEntries, {species: variantData.species}, _this.studiesList);
        variantGenotypeGridPanel.draw();

        return variantGenotypeGridPanel;
    }
};
