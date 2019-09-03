$(function () {

    var $valorunitario = $('input[name="valorunitario"]');
    $valorunitario.prop('readonly', true);

    $('select[name="iditem"]').on('select2:select', function (e) {
        application.jsfunction('erp.comercial.precovenda.js_getValorUnitario', { iditem: e.params.data.id }, function (response) {
            if (response.success) {
                $valorunitario.val(response.data);
            }
        });
    });

    if (application.functions.getUrlParameter('parent')) {
        Cookies.set('wizard-step', 1);
    }

});